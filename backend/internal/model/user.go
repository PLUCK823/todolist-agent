package model

import "time"

// User is the durable server-side identity used by both the Backend and Agent.
// PasswordHash must never be serialized into an API response.
type User struct {
	ID           string    `gorm:"type:uuid;primaryKey" json:"id"`
	Email        string    `gorm:"type:citext;uniqueIndex;not null" json:"email"`
	DisplayName  string    `gorm:"size:120;not null" json:"name"`
	Timezone     string    `gorm:"size:100;not null" json:"timezone"`
	PasswordHash string    `gorm:"not null" json:"-"`
	CreatedAt    time.Time `gorm:"autoCreateTime" json:"created_at"`
	UpdatedAt    time.Time `gorm:"autoUpdateTime" json:"updated_at"`
}

func (User) TableName() string { return "users" }

// AuthSession stores only the digest of an opaque refresh secret. Access and
// refresh token values are never persisted in plaintext.
type AuthSession struct {
	ID               string     `gorm:"type:uuid;primaryKey" json:"-"`
	UserID           string     `gorm:"type:uuid;not null;index" json:"-"`
	RefreshTokenHash string     `gorm:"type:char(64);uniqueIndex;not null" json:"-"`
	ExpiresAt        time.Time  `gorm:"not null;index" json:"-"`
	RevokedAt        *time.Time `gorm:"index" json:"-"`
	CreatedAt        time.Time  `gorm:"autoCreateTime" json:"-"`
	LastUsedAt       time.Time  `gorm:"not null" json:"-"`
	User             User       `gorm:"foreignKey:UserID;constraint:OnDelete:CASCADE" json:"-"`
}

func (AuthSession) TableName() string { return "auth_sessions" }
