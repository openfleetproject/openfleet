package config

type Config struct {
	OpAMP OpAMPServerConfig `mapstructure:"opamp"`
	Web   WebServerConfig   `mapstructure:"web"`
}
