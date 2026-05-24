package utils

import (
	"context"
	"log"

	"github.com/open-telemetry/opamp-go/client/types"
)

var _ types.Logger = &Logger{}

type Logger struct {
	logger *log.Logger
}

func NewLogger(l *log.Logger) *Logger {
	return &Logger{
		logger: l,
	}
}

func (l *Logger) Debugf(ctx context.Context, format string, v ...interface{}) {
	l.logger.Printf(format, v...)
}

func (l *Logger) Errorf(ctx context.Context, format string, v ...interface{}) {
	l.logger.Printf(format, v...)
}
