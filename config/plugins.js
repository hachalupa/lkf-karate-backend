module.exports = ({ env }) => ({
  email: {
    config: {
      provider: '@strapi/provider-email-nodemailer',
      providerOptions: {
        host: 'smtp.gmail.com',
        port: 587,
        auth: {
          user: env('GMAIL_USER'),
          pass: env('GMAIL_PASS'),
        },
      },
      settings: {
        defaultFrom: env('GMAIL_USER'),
        defaultReplyTo: env('GMAIL_USER'),
      },
    },
  },
  'users-permissions': {
    config: {
      jwt: {
        expiresIn: '7d',
      },
    },
  },
  upload: {
    config: {
      // NOTE: sizeLimit must live at the top level of plugin::upload config
      // (Strapi reads it via strapi.config.get('plugin::upload').sizeLimit)
      sizeLimit: 10000000, // 10MB
      breakpoints: {
        large: 1000,
        medium: 750,
        small: 500,
      },
      // Server-side file validation (Strapi 5 mime-validation). Rejects uploads
      // whose detected/declared MIME type is not in this allow list.
      security: {
        allowedTypes: [
          'image/png',
          'image/jpeg',
          'image/webp',
          'image/gif',
          'video/mp4',
          'video/webm',
        ],
      },
    },
  },
  'deep-populate': {
    enabled: true,
    config: {
      useCache: true,
      replaceWildcard: true,  // makes populate=* deep automatically
    }
  }
})