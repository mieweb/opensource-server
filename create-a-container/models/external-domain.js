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
        // Must be an absolute http(s) URL — it is interpolated directly into
        // nginx `proxy_pass`, which requires a scheme. Reject scheme-less hosts
        // (e.g. "oauth2-proxy:4180") and non-http schemes here so a bad value
        // can never reach the generated config.
        isHttpUrl(value) {
          if (value === null || value === undefined || value === '') return;
          let url;
          try {
            url = new URL(value);
          } catch (e) {
            throw new Error('authServer must be an absolute URL, e.g. http://127.0.0.1:4180');
          }
          if (url.protocol !== 'http:' && url.protocol !== 'https:') {
            throw new Error('authServer must use http or https');
          }
        }
      },
      comment: "Address of the oauth2-proxy process for nginx auth_request, e.g. http://127.0.0.1:4180. nginx proxies /oauth2/* straight to it in a single hop; do not point this at a path-prefixed URL."
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
