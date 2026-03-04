import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Performance Optimizations
  compress: true,
  poweredByHeader: false,

  // React Optimizations
  reactStrictMode: true,

  // Image Optimization
  images: {
    formats: ['image/avif', 'image/webp'],
    deviceSizes: [640, 750, 828, 1080, 1200, 1920],
    imageSizes: [16, 32, 48, 64, 96, 128, 256, 384],
    minimumCacheTTL: 3600,
  },

  // Turbopack
  turbopack: {},

  // Experimental Performance Features
  experimental: {
    optimizeCss: true,
    optimizePackageImports: [
      'lucide-react',
      'exceljs',
      'xlsx',
      'recharts',
      'gsap',
      'animejs',
      '@radix-ui/react-dialog',
      '@radix-ui/react-dropdown-menu',
    ],
  },

  // Strip all console.* in production builds (error/warn kept)
  compiler: {
    removeConsole: process.env.NODE_ENV === 'production' ? {
      exclude: ['error', 'warn'],
    } : false,
  },
  
  // Webpack optimizations
  webpack: (config, { dev, isServer }) => {
    // Only in production and client-side
    if (!dev && !isServer) {
      config.optimization = {
        ...config.optimization,
        splitChunks: {
          chunks: 'all',
          cacheGroups: {
            default: false,
            vendors: false,
            // Vendor chunk
            vendor: {
              name: 'vendor',
              chunks: 'all',
              test: /node_modules/,
              priority: 20,
            },
            // Separate large Excel libraries
            excelLibs: {
              test: /[\\/]node_modules[\\/](exceljs|xlsx)[\\/]/,
              name: 'excel-libs',
              chunks: 'async',
              priority: 30,
            },
          },
        },
      };
    }
    return config;
  },
};

export default nextConfig;
