"use client";

import { createContext, useContext } from "react";
import { hashtagFeedFor, type PickedFeedId } from "@/lib/legion/home-feeds";

/** The pinned feed a list of posts belongs to (home tab or hashtag page), for their #hashtag links. */
export const HashtagTab = createContext<PickedFeedId | null>(null);

/** The pinned feed a post's #hashtags link within (`hashtagFeedFor`); null for upstream's links. */
export function useHashtagFeed(channel: string | null | undefined): PickedFeedId | null {
  return hashtagFeedFor(channel, useContext(HashtagTab));
}
