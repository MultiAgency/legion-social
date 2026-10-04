/**
 * The site's name, from `NEXT_PUBLIC_SITE_NAME` (inlined at build time). Unset, it's upstream's
 * "near.social". Text about the original near.social (importing a profile, its image proxy) keeps
 * that name whatever this is.
 */
export const siteName = process.env.NEXT_PUBLIC_SITE_NAME || "near.social";
