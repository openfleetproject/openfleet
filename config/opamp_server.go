package config

type OpAMPServerConfig struct {
	Host string `mapstructure:"host"`
	Port int    `mapstructure:"port"`
}
