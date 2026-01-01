export type ChannelId = "all" | "store-a" | "store-b" | "store-c";

export type Channel = {
  id: ChannelId;
  label: string;
  /**
   * Gmail search query (same syntax as Gmail search box).
   * - all: undefined (no q)
   * - store-*: deliveredto:...
   */
  q?: string;
};

export type ChannelGroup = {
  label: string;
  items: Channel[];
};

export const CHANNELS: Channel[] = [
  { id: "all", label: "All" },
  {
    id: "store-a",
    label: "StoreA",
    q: "(deliveredto:shop-a@vtj.co.jp OR to:shop-a@vtj.co.jp OR cc:shop-a@vtj.co.jp)",
  },
  {
    id: "store-b",
    label: "StoreB",
    q: "(deliveredto:shop-b@vtj.co.jp OR to:shop-b@vtj.co.jp OR cc:shop-b@vtj.co.jp)",
  },
  {
    id: "store-c",
    label: "StoreC",
    q: "(deliveredto:shop-c@vtj.co.jp OR to:shop-c@vtj.co.jp OR cc:shop-c@vtj.co.jp)",
  },
];

export const DEFAULT_CHANNEL_ID: ChannelId = "all";

export const CHANNEL_GROUPS: ChannelGroup[] = [
  {
    label: "Stores",
    items: CHANNELS,
  },
];

export function getChannelById(id: string | undefined): Channel {
  const hit = CHANNELS.find((c) => c.id === id);
  return hit ?? CHANNELS[0];
}


