// Package config lê a configuração a partir de variáveis de ambiente.
package config

import (
	"errors"
	"os"
	"strconv"
)

type Config struct {
	Addr        string
	DatabaseURL string
	JWTSecret   string
	MaxTotal    float64

	AdminUsername string
	AdminPassword string

	TeacherUsername string
	TeacherPassword string
	TeacherName     string
}

func Load() (Config, error) {
	c := Config{
		Addr:            env("ADDR", ":8080"),
		DatabaseURL:     os.Getenv("DATABASE_URL"),
		JWTSecret:       os.Getenv("JWT_SECRET"),
		AdminUsername:   env("ADMIN_USERNAME", "admin"),
		AdminPassword:   os.Getenv("ADMIN_PASSWORD"),
		TeacherUsername: env("TEACHER_USERNAME", "Brunog"),
		TeacherPassword: os.Getenv("TEACHER_PASSWORD"),
		TeacherName:     env("TEACHER_NAME", "Prof. Bruno Gomes"),
		MaxTotal:        10,
	}
	if v := os.Getenv("MAX_TOTAL"); v != "" {
		f, err := strconv.ParseFloat(v, 64)
		if err != nil {
			return c, errors.New("MAX_TOTAL inválido")
		}
		c.MaxTotal = f
	}
	switch {
	case c.DatabaseURL == "":
		return c, errors.New("DATABASE_URL é obrigatório")
	case len(c.JWTSecret) < 32:
		return c, errors.New("JWT_SECRET deve ter pelo menos 32 caracteres")
	case len(c.AdminPassword) < 12:
		return c, errors.New("ADMIN_PASSWORD deve ter pelo menos 12 caracteres")
	case c.TeacherPassword == "":
		return c, errors.New("TEACHER_PASSWORD é obrigatório")
	}
	return c, nil
}

func env(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
