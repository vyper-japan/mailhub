export type RmsEnvPrefix = "RMS_STORE_A" | "RMS_STORE_B" | "RMS_STORE_C";

export type ChannelId =
  | "all"
  | "store-a"
  | "store-b"
  | "store-c"
  | "cricut-rakuten"
  | "cricut-yahoo"
  | "cricut-amazon"
  | "cricut-makeshop"
  | "gopro-rakuten"
  | "gopro-yahoo"
  | "gopro-mp"
  | "vyperglobal-rakuten"
  | "vyperglobal-yahoo"
  | "vyperglobal-amazon"
  | "vyper-amazon"
  | "datacolor"
  | "akg"
  | "sbd"
  | "secondhand"
  | "steiner"
  | "ebay";

export type ChannelDef = {
  id: ChannelId;
  label: string;
  addresses: string[];
  q?: string;
  replyKind: "gmail" | "rakuten_rms";
  rmsEnvPrefix?: RmsEnvPrefix;
};

export type Channel = ChannelDef;

export const DEFAULT_CHANNEL_ID: ChannelId = "all";

function makeDeliveredToQuery(address: string): string {
  return `(deliveredto:${address} OR to:${address} OR cc:${address})`;
}

export function buildAddressQuery(addresses: string[]): string | undefined {
  const normalized = addresses.map((address) => address.trim()).filter(Boolean);
  if (normalized.length === 0) return undefined;
  if (normalized.length === 1) return `to:${normalized[0]}`;
  return `to:(${normalized.join(" OR ")})`;
}

const TEST_CHANNELS: ChannelDef[] = [
  { id: "all", label: "All", addresses: [], replyKind: "gmail" },
  {
    id: "store-a",
    label: "StoreA",
    addresses: ["shop-a@vtj.co.jp"],
    q: makeDeliveredToQuery("shop-a@vtj.co.jp"),
    replyKind: "rakuten_rms",
    rmsEnvPrefix: "RMS_STORE_A",
  },
  {
    id: "store-b",
    label: "StoreB",
    addresses: ["shop-b@vtj.co.jp"],
    q: makeDeliveredToQuery("shop-b@vtj.co.jp"),
    replyKind: "rakuten_rms",
    rmsEnvPrefix: "RMS_STORE_B",
  },
  {
    id: "store-c",
    label: "StoreC",
    addresses: ["shop-c@vtj.co.jp"],
    q: makeDeliveredToQuery("shop-c@vtj.co.jp"),
    replyKind: "rakuten_rms",
    rmsEnvPrefix: "RMS_STORE_C",
  },
];

const PROD_CHANNELS: ChannelDef[] = ([
  { id: "all", label: "All", addresses: [], replyKind: "gmail" },
  {
    id: "cricut-rakuten",
    label: "Cricut 楽天",
    addresses: ["cricut_r@vtj.co.jp"],
    replyKind: "rakuten_rms",
    rmsEnvPrefix: "RMS_STORE_A",
  },
  {
    id: "cricut-yahoo",
    label: "Cricut Yahoo",
    addresses: ["cricut_y@vtj.co.jp"],
    replyKind: "gmail",
  },
  {
    id: "cricut-amazon",
    label: "Cricut Amazon",
    addresses: ["cricut_sc@vtj.co.jp"],
    replyKind: "gmail",
  },
  {
    id: "cricut-makeshop",
    label: "Cricut オンラインストア",
    addresses: ["cricut_makeshop@vtj.co.jp"],
    replyKind: "gmail",
  },
  {
    id: "gopro-rakuten",
    label: "GoPro 楽天",
    addresses: [
      "gopro_r@vtj.co.jp",
      "gopro_order_rakuten@vtj.co.jp",
      "gopro_rakuten@vtj.co.jp",
    ],
    replyKind: "rakuten_rms",
    rmsEnvPrefix: "RMS_STORE_B",
  },
  {
    id: "gopro-yahoo",
    label: "GoPro Yahoo",
    addresses: ["gopro_y@vtj.co.jp", "gopro_order_yahoo@vtj.co.jp"],
    replyKind: "gmail",
  },
  {
    id: "gopro-mp",
    label: "GoPro MP",
    addresses: ["gopro_mp@vtj.co.jp"],
    replyKind: "gmail",
  },
  {
    id: "vyperglobal-rakuten",
    label: "VYPER GLOBAL 楽天",
    addresses: ["vyper_r@vtj.co.jp", "vyper_rakuten@vtj.co.jp"],
    replyKind: "rakuten_rms",
    rmsEnvPrefix: "RMS_STORE_C",
  },
  {
    id: "vyperglobal-yahoo",
    label: "VYPER GLOBAL Yahoo",
    addresses: ["vyperglobal_y@vtj.co.jp"],
    replyKind: "gmail",
  },
  {
    id: "vyperglobal-amazon",
    label: "VYPER GLOBAL Amazon",
    addresses: ["vyperglobal_sc@vtj.co.jp"],
    replyKind: "gmail",
  },
  {
    id: "vyper-amazon",
    label: "VYPER SC",
    addresses: ["vyper_sc@vtj.co.jp"],
    replyKind: "gmail",
  },
  {
    id: "datacolor",
    label: "Datacolor Shopify",
    addresses: ["datacolor_shopify@vtj.co.jp"],
    replyKind: "gmail",
  },
  {
    id: "akg",
    label: "AKGストア",
    addresses: ["akgstore@vtj.co.jp"],
    replyKind: "gmail",
  },
  {
    id: "sbd",
    label: "SBD (Black & Decker)",
    addresses: ["sbd@vtj.co.jp"],
    replyKind: "gmail",
  },
  {
    id: "secondhand",
    label: "セカンドハンド",
    addresses: ["secondhand@vtj.co.jp"],
    replyKind: "gmail",
  },
  {
    id: "steiner",
    label: "Steiner Optics",
    addresses: ["steiner-optics_sc@vtj.co.jp"],
    replyKind: "gmail",
  },
  {
    id: "ebay",
    label: "eBay",
    addresses: ["ebay@vtj.co.jp"],
    replyKind: "gmail",
  },
] satisfies ChannelDef[]).map((channel) => {
  const q = buildAddressQuery(channel.addresses);
  return q ? { ...channel, q } : channel;
});

function cloneChannel(channel: ChannelDef): ChannelDef {
  return {
    ...channel,
    addresses: [...channel.addresses],
  };
}

export function getChannels(testMode: boolean): ChannelDef[] {
  return (testMode ? TEST_CHANNELS : PROD_CHANNELS).map(cloneChannel);
}

export function getChannelById(id: string | undefined, testMode: boolean): ChannelDef {
  const channels = getChannels(testMode);
  return channels.find((channel) => channel.id === id) ?? channels[0];
}

export function coerceChannelId(
  id: string | undefined,
  testMode: boolean,
): ChannelId | undefined {
  if (!id) return undefined;
  const channel = (testMode ? TEST_CHANNELS : PROD_CHANNELS).find((item) => item.id === id);
  return channel?.id;
}

export function getRmsEnvPrefix(id: string | undefined, testMode: boolean): RmsEnvPrefix | undefined {
  return getChannelById(id, testMode).rmsEnvPrefix;
}
