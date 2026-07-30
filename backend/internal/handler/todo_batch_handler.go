package handler

import (
	"errors"
	"net/http"

	"backend/internal/service"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

type TodoBatchServiceInterface interface {
	BatchCreate(service.BatchCreateRequest) (*service.BatchTodosResponse, error)
	BatchGet(service.BatchIDsRequest) (*service.BatchTodosResponse, error)
	BatchUpdate(service.BatchUpdateRequest) (*service.BatchTodosResponse, error)
	BatchSetStatus(service.BatchStatusRequest) (*service.BatchTodosResponse, error)
	BatchDelete(service.BatchIDsRequest) (*service.BatchTodosResponse, error)
}

func errorResponseWithData(c *gin.Context, status, code int, message string, data any) {
	c.JSON(status, gin.H{"code": code, "message": message, "data": data})
}

func (h *TodoHandler) handleBatchError(c *gin.Context, err error) {
	var itemErr *service.BatchItemError
	switch {
	case errors.As(err, &itemErr):
		errorResponseWithData(c, http.StatusBadRequest, 40002, itemErr.Message, gin.H{
			"index": itemErr.Index, "id": itemErr.ID, "field": itemErr.Field,
		})
	case errors.Is(err, service.ErrInvalidBatch):
		errorResponse(c, http.StatusBadRequest, 40001, "批量请求必须包含 1 到 100 个不重复项目")
	case errors.Is(err, service.ErrTodoNotFound), errors.Is(err, gorm.ErrRecordNotFound):
		errorResponse(c, http.StatusNotFound, 40401, "一个或多个待办不存在")
	default:
		errorResponse(c, http.StatusInternalServerError, 50001, "服务器内部错误")
	}
}

func bindBatchJSON(c *gin.Context, target any) bool {
	if err := c.ShouldBindJSON(target); err != nil {
		errorResponse(c, http.StatusBadRequest, 40001, "请求参数格式错误")
		return false
	}
	return true
}

func (h *TodoHandler) unavailableBatch(c *gin.Context) bool {
	if h.batchSvc == nil {
		errorResponse(c, http.StatusInternalServerError, 50001, "服务器内部错误")
		return true
	}
	return false
}

func (h *TodoHandler) BatchCreateTodos(c *gin.Context) {
	if h.unavailableBatch(c) {
		return
	}
	var req service.BatchCreateRequest
	if !bindBatchJSON(c, &req) {
		return
	}
	result, err := h.batchSvc.BatchCreate(req)
	if err != nil {
		h.handleBatchError(c, err)
		return
	}
	success(c, http.StatusCreated, result)
}

func (h *TodoHandler) BatchGetTodos(c *gin.Context) {
	if h.unavailableBatch(c) {
		return
	}
	var req service.BatchIDsRequest
	if !bindBatchJSON(c, &req) {
		return
	}
	result, err := h.batchSvc.BatchGet(req)
	if err != nil {
		h.handleBatchError(c, err)
		return
	}
	success(c, http.StatusOK, result)
}

func (h *TodoHandler) BatchUpdateTodos(c *gin.Context) {
	if h.unavailableBatch(c) {
		return
	}
	var req service.BatchUpdateRequest
	if !bindBatchJSON(c, &req) {
		return
	}
	result, err := h.batchSvc.BatchUpdate(req)
	if err != nil {
		h.handleBatchError(c, err)
		return
	}
	success(c, http.StatusOK, result)
}

func (h *TodoHandler) BatchSetTodoStatus(c *gin.Context) {
	if h.unavailableBatch(c) {
		return
	}
	var req service.BatchStatusRequest
	if !bindBatchJSON(c, &req) {
		return
	}
	result, err := h.batchSvc.BatchSetStatus(req)
	if err != nil {
		h.handleBatchError(c, err)
		return
	}
	success(c, http.StatusOK, result)
}

func (h *TodoHandler) BatchDeleteTodos(c *gin.Context) {
	if h.unavailableBatch(c) {
		return
	}
	var req service.BatchIDsRequest
	if !bindBatchJSON(c, &req) {
		return
	}
	result, err := h.batchSvc.BatchDelete(req)
	if err != nil {
		h.handleBatchError(c, err)
		return
	}
	success(c, http.StatusOK, result)
}
