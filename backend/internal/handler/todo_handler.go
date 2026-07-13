package handler

import (
	"errors"
	"net/http"
	"strconv"

	"backend/internal/model"
	"backend/internal/service"

	"github.com/gin-gonic/gin"
)

// TodoServiceInterface defines what the handler needs from the service
type TodoServiceInterface interface {
	Create(req service.CreateTodoRequest) (*model.Todo, error)
	GetByID(id uint) (*model.Todo, error)
	List(req service.ListTodosRequest) (*service.ListTodosResponse, error)
	Update(id uint, req service.UpdateTodoRequest) (*model.Todo, error)
	Delete(id uint) error
	Complete(id uint) (*model.Todo, error)
	Uncomplete(id uint) (*model.Todo, error)
}

// TodoHandler handles HTTP requests for todos
type TodoHandler struct {
	svc TodoServiceInterface
}

// NewTodoHandler creates a new TodoHandler
func NewTodoHandler(svc TodoServiceInterface) *TodoHandler {
	return &TodoHandler{svc: svc}
}

// response helpers
func success(c *gin.Context, status int, data interface{}) {
	c.JSON(status, gin.H{
		"code":    0,
		"message": "ok",
		"data":    data,
	})
}

func errorResponse(c *gin.Context, httpStatus int, code int, message string) {
	c.JSON(httpStatus, gin.H{
		"code":    code,
		"message": message,
		"data":    nil,
	})
}

// HealthCheck handles GET /api/health
func HealthCheck(c *gin.Context) {
	success(c, http.StatusOK, gin.H{"status": "ok"})
}

// CreateTodo handles POST /api/todos
func (h *TodoHandler) CreateTodo(c *gin.Context) {
	var req service.CreateTodoRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		errorResponse(c, http.StatusBadRequest, 40001, "请求参数格式错误")
		return
	}

	todo, err := h.svc.Create(req)
	if err != nil {
		if errors.Is(err, model.ErrEmptyTitle) {
			errorResponse(c, http.StatusBadRequest, 40001, err.Error())
			return
		}
		if errors.Is(err, model.ErrTitleTooLong) {
			errorResponse(c, http.StatusBadRequest, 40001, err.Error())
			return
		}
		if errors.Is(err, model.ErrInvalidPriority) {
			errorResponse(c, http.StatusBadRequest, 40001, err.Error())
			return
		}
		errorResponse(c, http.StatusInternalServerError, 50001, "服务器内部错误")
		return
	}

	success(c, http.StatusCreated, todo)
}

// GetTodo handles GET /api/todos/:id
func (h *TodoHandler) GetTodo(c *gin.Context) {
	id, err := parseIDParam(c)
	if err != nil {
		errorResponse(c, http.StatusBadRequest, 40001, "无效的待办ID")
		return
	}

	todo, err := h.svc.GetByID(id)
	if err != nil {
		if errors.Is(err, service.ErrTodoNotFound) {
			errorResponse(c, http.StatusNotFound, 40401, "待办不存在")
			return
		}
		errorResponse(c, http.StatusInternalServerError, 50001, "服务器内部错误")
		return
	}

	success(c, http.StatusOK, todo)
}

// ListTodos handles GET /api/todos
func (h *TodoHandler) ListTodos(c *gin.Context) {
	var req service.ListTodosRequest
	if err := c.ShouldBindQuery(&req); err != nil {
		errorResponse(c, http.StatusBadRequest, 40001, "查询参数格式错误")
		return
	}

	result, err := h.svc.List(req)
	if err != nil {
		errorResponse(c, http.StatusInternalServerError, 50001, "服务器内部错误")
		return
	}

	success(c, http.StatusOK, result)
}

// UpdateTodo handles PUT /api/todos/:id
func (h *TodoHandler) UpdateTodo(c *gin.Context) {
	id, err := parseIDParam(c)
	if err != nil {
		errorResponse(c, http.StatusBadRequest, 40001, "无效的待办ID")
		return
	}

	var req service.UpdateTodoRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		errorResponse(c, http.StatusBadRequest, 40001, "请求参数格式错误")
		return
	}

	todo, err := h.svc.Update(id, req)
	if err != nil {
		if errors.Is(err, service.ErrTodoNotFound) {
			errorResponse(c, http.StatusNotFound, 40401, "待办不存在")
			return
		}
		if errors.Is(err, model.ErrEmptyTitle) {
			errorResponse(c, http.StatusBadRequest, 40001, err.Error())
			return
		}
		if errors.Is(err, model.ErrInvalidPriority) {
			errorResponse(c, http.StatusBadRequest, 40001, err.Error())
			return
		}
		errorResponse(c, http.StatusInternalServerError, 50001, "服务器内部错误")
		return
	}

	success(c, http.StatusOK, todo)
}

// DeleteTodo handles DELETE /api/todos/:id
func (h *TodoHandler) DeleteTodo(c *gin.Context) {
	id, err := parseIDParam(c)
	if err != nil {
		errorResponse(c, http.StatusBadRequest, 40001, "无效的待办ID")
		return
	}

	err = h.svc.Delete(id)
	if err != nil {
		if errors.Is(err, service.ErrTodoNotFound) {
			errorResponse(c, http.StatusNotFound, 40401, "待办不存在")
			return
		}
		errorResponse(c, http.StatusInternalServerError, 50001, "服务器内部错误")
		return
	}

	success(c, http.StatusOK, nil)
}

// CompleteTodo handles PATCH /api/todos/:id/complete
func (h *TodoHandler) CompleteTodo(c *gin.Context) {
	id, err := parseIDParam(c)
	if err != nil {
		errorResponse(c, http.StatusBadRequest, 40001, "无效的待办ID")
		return
	}

	todo, err := h.svc.Complete(id)
	if err != nil {
		if errors.Is(err, service.ErrTodoNotFound) {
			errorResponse(c, http.StatusNotFound, 40401, "待办不存在")
			return
		}
		errorResponse(c, http.StatusInternalServerError, 50001, "服务器内部错误")
		return
	}

	success(c, http.StatusOK, todo)
}

// UncompleteTodo handles PATCH /api/todos/:id/uncomplete
func (h *TodoHandler) UncompleteTodo(c *gin.Context) {
	id, err := parseIDParam(c)
	if err != nil {
		errorResponse(c, http.StatusBadRequest, 40001, "无效的待办ID")
		return
	}

	todo, err := h.svc.Uncomplete(id)
	if err != nil {
		if errors.Is(err, service.ErrTodoNotFound) {
			errorResponse(c, http.StatusNotFound, 40401, "待办不存在")
			return
		}
		errorResponse(c, http.StatusInternalServerError, 50001, "服务器内部错误")
		return
	}

	success(c, http.StatusOK, todo)
}

// parseIDParam extracts and parses the :id path parameter
func parseIDParam(c *gin.Context) (uint, error) {
	idStr := c.Param("id")
	id, err := strconv.ParseUint(idStr, 10, 64)
	if err != nil {
		return 0, err
	}
	return uint(id), nil
}

// RegisterRoutes registers all todo routes on the given router
func RegisterRoutes(r *gin.Engine, svc TodoServiceInterface) {
	h := NewTodoHandler(svc)

	r.GET("/api/health", HealthCheck)

	todoGroup := r.Group("/api/todos")
	{
		todoGroup.GET("", h.ListTodos)
		todoGroup.GET("/:id", h.GetTodo)
		todoGroup.POST("", h.CreateTodo)
		todoGroup.PUT("/:id", h.UpdateTodo)
		todoGroup.DELETE("/:id", h.DeleteTodo)
		todoGroup.PATCH("/:id/complete", h.CompleteTodo)
		todoGroup.PATCH("/:id/uncomplete", h.UncompleteTodo)
	}
}
