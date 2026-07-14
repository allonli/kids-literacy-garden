import type { NextConfig } from "next";

const isGitHubPages = process.env.GITHUB_PAGES === "true";

const nextConfig: NextConfig = {
  output: isGitHubPages ? "export" : undefined,
  basePath: isGitHubPages ? "/kids-literacy-garden" : undefined,
  assetPrefix: isGitHubPages ? "/kids-literacy-garden/" : undefined,
  trailingSlash: isGitHubPages,
};

export default nextConfig;
