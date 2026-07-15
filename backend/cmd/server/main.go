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
	viper.SetDefault("SERVER_PORT", "8080")
	viper.SetDefault("DB_DRIVER", "postgres")
	viper.SetDefault("DB_DSN", "host=localhost user=todolist password=todolist123 dbname=todolist port=5432 sslmode=disable TimeZone=Asia/Shanghai")
	viper.SetDefault("GIN_MODE", "release")

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
	if v := os.Getenv("GIN_MODE"); v != "" {
		viper.Set("GIN_MODE", v)
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

	router := gin.New()
	router.Use(middleware.CORS())
	router.Use(middleware.Logger(logger))
	router.Use(gin.Recovery())
	handler.RegisterRoutes(router, todoSvc)

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
