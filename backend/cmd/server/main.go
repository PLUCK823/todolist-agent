package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"backend/internal/database"
	"backend/internal/handler"
	"backend/internal/middleware"
	"backend/internal/repository"
	"backend/internal/service"

	"github.com/gin-gonic/gin"
	"github.com/spf13/viper"
	"go.uber.org/zap"
)

func initConfig() {
	viper.Reset()
	viper.SetDefault("SERVER_PORT", "8080")
	viper.SetDefault("DB_DRIVER", "postgres")
	viper.SetDefault("DB_DSN", "host=localhost user=todolist password=todolist123 dbname=todolist port=5432 sslmode=disable TimeZone=Asia/Shanghai")
	viper.SetDefault("GIN_MODE", "release")
	viper.SetDefault("AUTH_ACCESS_COOKIE", "todolist_access")
	viper.SetDefault("AUTH_REFRESH_COOKIE", "todolist_refresh")
	viper.SetDefault("AUTH_ALLOWED_ORIGINS", "http://localhost:3000")
	viper.SetDefault("AUTH_COOKIE_SECURE", false)
	viper.SetDefault("AUTH_COOKIE_DOMAIN", "")
	viper.SetDefault("AUTH_PASSWORD_CONCURRENCY", 4)
	viper.SetDefault("AUTH_LOGIN_IP_LIMIT", 30)
	viper.SetDefault("AUTH_LOGIN_ACCOUNT_LIMIT", 10)
	viper.SetDefault("AUTH_LOGIN_RATE_WINDOW_SECONDS", 60)
	viper.SetDefault("AUTH_LOGIN_RATE_CAPACITY", 4096)
	viper.SetDefault("AUTH_TRUSTED_PROXY_CIDRS", "")

	viper.AutomaticEnv()

	if v := os.Getenv("SERVER_PORT"); v != "" {
		viper.Set("SERVER_PORT", v)
	}
	if v := os.Getenv("DB_DRIVER"); v != "" {
		viper.Set("DB_DRIVER", v)
	}
	if v := os.Getenv("DB_DSN"); v != "" {
		viper.Set("DB_DSN", v)
	}

	gin.SetMode(viper.GetString("GIN_MODE"))
}

func setupLogger() (*zap.Logger, error) {
	return zap.NewProduction()
}

// SetupApp initializes DB, services, and router. Returns the router and logger for use.
func SetupApp() (*gin.Engine, *zap.Logger, error) {
	initConfig()

	logger, err := setupLogger()
	if err != nil {
		return nil, nil, fmt.Errorf("failed to initialize logger: %w", err)
	}
	jwtSecret := viper.GetString("AUTH_JWT_SECRET")
	if len([]byte(jwtSecret)) < 32 {
		return nil, logger, service.ErrWeakJWTSecret
	}
	clientIPResolver, err := handler.NewTrustedProxyClientIPResolver(viper.GetString("AUTH_TRUSTED_PROXY_CIDRS"))
	if err != nil {
		return nil, logger, fmt.Errorf("configure trusted proxy CIDRs: %w", err)
	}

	db, err := database.InitDB(database.Config{
		Driver: viper.GetString("DB_DRIVER"),
		DSN:    viper.GetString("DB_DSN"),
	})
	if err != nil {
		logger.Error("failed to initialize database", zap.Error(err))
		return nil, logger, err
	}
	logger.Info("Database connected successfully")

	todoRepo := repository.NewTodoRepository(db)
	todoSvc := service.NewTodoService(todoRepo)
	authRepo := repository.NewAuthRepository(db)
	authSvc, err := service.NewAuthService(authRepo, service.AuthConfig{
		JWTSecret:           []byte(jwtSecret),
		PasswordConcurrency: viper.GetInt("AUTH_PASSWORD_CONCURRENCY"),
		LoginIPLimit:        viper.GetInt("AUTH_LOGIN_IP_LIMIT"),
		LoginAccountLimit:   viper.GetInt("AUTH_LOGIN_ACCOUNT_LIMIT"),
		LoginRateWindow:     time.Duration(viper.GetInt("AUTH_LOGIN_RATE_WINDOW_SECONDS")) * time.Second,
		LoginRateCapacity:   viper.GetInt("AUTH_LOGIN_RATE_CAPACITY"),
	})
	if err != nil {
		return nil, logger, fmt.Errorf("initialize authentication service: %w", err)
	}
	authHandler := handler.NewAuthHandlerWithOptions(authSvc, handler.CookieConfig{
		AccessName:  viper.GetString("AUTH_ACCESS_COOKIE"),
		RefreshName: viper.GetString("AUTH_REFRESH_COOKIE"),
		Secure:      viper.GetBool("AUTH_COOKIE_SECURE"),
		Domain:      viper.GetString("AUTH_COOKIE_DOMAIN"),
	}, handler.AuthHandlerOptions{ClientIPResolver: clientIPResolver})

	router := gin.New()
	router.Use(middleware.CORS())
	router.Use(middleware.Logger(logger))
	router.Use(gin.Recovery())
	handler.RegisterRoutes(router, todoSvc)
	handler.RegisterAuthRoutes(router, authHandler, viper.GetString("AUTH_ALLOWED_ORIGINS"))

	return router, logger, nil
}

func main() {
	router, logger, err := SetupApp()
	if err != nil {
		if logger != nil {
			logger.Fatal("failed to setup application", zap.Error(err))
		}
		log.Fatalf("failed to setup application: %v", err)
	}
	defer logger.Sync()

	port := viper.GetString("SERVER_PORT")
	srv := &http.Server{
		Addr:    fmt.Sprintf(":%s", port),
		Handler: router,
	}

	go func() {
		logger.Info("Server starting", zap.String("port", port))
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			logger.Fatal("failed to start server", zap.Error(err))
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	logger.Info("Shutting down server...")
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := srv.Shutdown(ctx); err != nil {
		logger.Fatal("forced to shutdown", zap.Error(err))
	}

	logger.Info("Server exited")
}
