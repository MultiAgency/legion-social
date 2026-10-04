/**
 * The site's name, from `NEXT_PUBLIC_SITE_NAME` (inlined at build time). Unset, it's upstream's
 * "near.social". Text about the original near.social (importing a profile, its image proxy) keeps
 * that name whatever this is.
 */
export const siteName = process.env.NEXT_PUBLIC_SITE_NAME || "near.social";

/** The site's one-line pitch, from `NEXT_PUBLIC_SITE_TAGLINE`. Unset, it's upstream's. */
export const siteTagline = process.env.NEXT_PUBLIC_SITE_TAGLINE || "The open social network on NEAR.";

/** The page description: the tagline when one is set, else upstream's wording. */
export const siteDescription = `${
  process.env.NEXT_PUBLIC_SITE_TAGLINE ? siteTagline : `${siteName}: an open social network on NEAR.`
} Every post, like and follow is public data on FastData KV.`;
