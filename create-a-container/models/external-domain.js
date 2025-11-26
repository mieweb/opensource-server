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
    eabKid: {
      type: DataTypes.STRING,
      allowNull: true,
      comment: 'External Account Binding Key Identifier (for ACME providers like ZeroSSL)'
    },
    eabHmac: {
      type: DataTypes.STRING,
      allowNull: true,
      comment: 'External Account Binding HMAC key (for ACME providers like ZeroSSL)'
    },
    siteId: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'Sites',
        key: 'id'
      }
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
