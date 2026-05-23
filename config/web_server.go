package config

type WebServerConfig struct {
	Host string `mapstructure:"host"`
	Port int    `mapstructure:"port"`
}
