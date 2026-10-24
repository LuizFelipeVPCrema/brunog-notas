package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"brunog.lfvpc.cloud/notas/internal/api"
	"brunog.lfvpc.cloud/notas/internal/auth"
	"brunog.lfvpc.cloud/notas/internal/config"
	"brunog.lfvpc.cloud/notas/internal/db"
	"brunog.lfvpc.cloud/notas/internal/store"
)

func main() {
	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, nil)))
	// "server healthcheck" é usado pelo HEALTHCHECK do Docker (a imagem não tem curl).
	if len(os.Args) > 1 && os.Args[1] == "healthcheck" {
		resp, err := http.Get("http://127.0.0.1:8080/api/healthz")
		if err != nil || resp.StatusCode != http.StatusOK {
			os.Exit(1)
		}
		return
	}
	if err := run(); err != nil {
		slog.Error("encerrando", "err", err)
		os.Exit(1)
	}
}

func run() error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	pool, err := db.Connect(ctx, cfg.DatabaseURL)
	if err != nil {
		return err
	}
	defer pool.Close()
	if err := db.Migrate(ctx, pool); err != nil {
		return err
	}

	st := store.New(pool, cfg.MaxTotal)
	// Os únicos dois usuários do sistema; não há cadastro pela interface.
	if err := st.EnsureUser(ctx, cfg.AdminUsername, "Administrador", "admin", cfg.AdminPassword); err != nil {
		return err
	}
	if err := st.EnsureUser(ctx, cfg.TeacherUsername, cfg.TeacherName, "teacher", cfg.TeacherPassword); err != nil {
		return err
	}

	srv := &http.Server{
		Addr:              cfg.Addr,
		Handler:           api.New(st, auth.NewService(cfg.JWTSecret)),
		ReadHeaderTimeout: 10 * time.Second,
	}
	go func() {
		<-ctx.Done()
		shutdown, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = srv.Shutdown(shutdown)
	}()
	slog.Info("API ouvindo", "addr", cfg.Addr)
	if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	return nil
}
