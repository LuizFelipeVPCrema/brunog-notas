// Package auth cuida de senhas, tokens JWT e do middleware de autenticação.
package auth

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"
)

const tokenTTL = 12 * time.Hour

type User struct {
	ID       int64  `json:"id"`
	Username string `json:"username"`
	Name     string `json:"name"`
	Role     string `json:"role"`
}

type claims struct {
	Username string `json:"usr"`
	Name     string `json:"name"`
	Role     string `json:"role"`
	jwt.RegisteredClaims
}

type Service struct {
	secret []byte
}

func NewService(secret string) *Service {
	return &Service{secret: []byte(secret)}
}

func HashPassword(pw string) (string, error) {
	h, err := bcrypt.GenerateFromPassword([]byte(pw), 12)
	return string(h), err
}

func CheckPassword(hash, pw string) bool {
	return bcrypt.CompareHashAndPassword([]byte(hash), []byte(pw)) == nil
}

// DummyCheck gasta o mesmo tempo de uma verificação real, para não revelar
// pelo tempo de resposta se o usuário existe.
func DummyCheck(pw string) {
	dummyOnce.Do(func() { dummyHash, _ = bcrypt.GenerateFromPassword([]byte("senha-inexistente"), 12) })
	_ = bcrypt.CompareHashAndPassword(dummyHash, []byte(pw))
}

var (
	dummyOnce sync.Once
	dummyHash []byte
)

func (s *Service) Issue(u User) (string, time.Time, error) {
	exp := time.Now().Add(tokenTTL)
	tok := jwt.NewWithClaims(jwt.SigningMethodHS256, claims{
		Username: u.Username, Name: u.Name, Role: u.Role,
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   strconv.FormatInt(u.ID, 10),
			ExpiresAt: jwt.NewNumericDate(exp),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
		},
	})
	signed, err := tok.SignedString(s.secret)
	return signed, exp, err
}

func (s *Service) Parse(token string) (User, error) {
	var c claims
	_, err := jwt.ParseWithClaims(token, &c, func(t *jwt.Token) (any, error) {
		return s.secret, nil
	}, jwt.WithValidMethods([]string{jwt.SigningMethodHS256.Alg()}), jwt.WithExpirationRequired())
	if err != nil {
		return User{}, err
	}
	id, err := strconv.ParseInt(c.Subject, 10, 64)
	if err != nil {
		return User{}, errors.New("token inválido")
	}
	return User{ID: id, Username: c.Username, Name: c.Name, Role: c.Role}, nil
}

type ctxKey struct{}

// Middleware exige um token Bearer válido.
func (s *Service) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := r.Header.Get("Authorization")
		token, ok := strings.CutPrefix(h, "Bearer ")
		if !ok {
			http.Error(w, `{"error":"não autenticado"}`, http.StatusUnauthorized)
			return
		}
		u, err := s.Parse(token)
		if err != nil {
			http.Error(w, `{"error":"sessão expirada, faça login novamente"}`, http.StatusUnauthorized)
			return
		}
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), ctxKey{}, u)))
	})
}

func FromContext(ctx context.Context) User {
	u, _ := ctx.Value(ctxKey{}).(User)
	return u
}

// Limiter bloqueia temporariamente um IP após muitas tentativas de login erradas.
type Limiter struct {
	mu       sync.Mutex
	failures map[string][]time.Time
	max      int
	window   time.Duration
}

func NewLimiter(max int, window time.Duration) *Limiter {
	return &Limiter{failures: map[string][]time.Time{}, max: max, window: window}
}

func (l *Limiter) Allowed(key string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	return len(l.prune(key)) < l.max
}

func (l *Limiter) Fail(key string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.failures[key] = append(l.prune(key), time.Now())
}

func (l *Limiter) Reset(key string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	delete(l.failures, key)
}

func (l *Limiter) prune(key string) []time.Time {
	cutoff := time.Now().Add(-l.window)
	list := l.failures[key]
	i := 0
	for i < len(list) && list[i].Before(cutoff) {
		i++
	}
	list = list[i:]
	if len(list) == 0 {
		delete(l.failures, key)
	} else {
		l.failures[key] = list
	}
	return list
}
