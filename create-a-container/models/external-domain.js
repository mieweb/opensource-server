const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const ExternalDomain = sequelize.define('ExternalDomain', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false,
      validate: {
        notEmpty: true
      },
      comment: 'Domain name (e.g., example.com)'
    },
    acmeEmail: {
      type: DataTypes.STRING,
      allowNull: true,
      validate: {
        isEmail: true
      },
      comment: 'Email address for ACME certificate registration'
    },
    acmeDirectoryUrl: {
      type: DataTypes.STRING,
      allowNull: true,
      validate: {
        isUrl: true
      },
      comment: 'ACME directory URL (e.g., https://acme-v02.api.letsencrypt.org/directory)'
    },
    cloudflareApiEmail: {
      type: DataTypes.STRING,
      allowNull: true,
      validate: {
        isEmail: true
      },
      comment: 'Cloudflare API email for DNS challenge'
    },
    cloudflareApiKey: {
      type: DataTypes.STRING,
      allowNull: true,
      comment: 'Cloudflare API key for DNS challenge'
    },
    siteId: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: 'Sites',
        key: 'id'
      },
      comment: 'Optional default site — when null, domain has no default site'
    },
    authServer: {
      type: DataTypes.STRING,
      allowNull: true,
      validate: {
        isUrl: true
      },
      comment: 'Public oauth2-proxy URL for nginx auth_request (e.g., https://oauth2-proxy.example.com). A routable host on the same load balancer that proxies to an administrator-run oauth2-proxy; protected services delegate auth to it.'
    }
  }, {
    tableName: 'ExternalDomains',
    timestamps: true
  });

  ExternalDomain.associate = (models) => {
    ExternalDomain.belongsTo(models.Site, {
      foreignKey: 'siteId',
      as: 'site'
    });
  };

  return ExternalDomain;
};
