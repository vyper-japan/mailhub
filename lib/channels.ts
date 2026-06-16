export type RmsEnvPrefix = "RMS_STORE_A" | "RMS_STORE_B" | "RMS_STORE_C";

export type ChannelId =
  | "all"
  | "stores"
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
  | "ams-vyper"
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
  relatedQ?: string;
  replyKind: "gmail" | "rakuten_rms";
  rmsEnvPrefix?: RmsEnvPrefix;
};

export type Channel = ChannelDef;

export type ChannelSourceScope = {
  channel: Pick<ChannelDef, "id" | "label" | "addresses" | "relatedQ">;
  sourceChannels: Array<Pick<ChannelDef, "id" | "label" | "addresses">>;
  sourceAddresses: string[];
  isAggregate: boolean;
};

export const DEFAULT_CHANNEL_ID: ChannelId = "all";

function makeDeliveredToQuery(address: string): string {
  return `(deliveredto:${address} OR to:${address} OR cc:${address})`;
}

export function buildAddressQuery(addresses: string[]): string | undefined {
  const normalized = addresses.map((address) => address.trim()).filter(Boolean);
  if (normalized.length === 0) return undefined;
  const parts = normalized.map(makeDeliveredToQuery);
  return parts.length === 1 ? parts[0] : `(${parts.join(" OR ")})`;
}

function wrapQueryPart(q: string): string {
  return q.startsWith("(") && q.endsWith(")") ? q : `(${q})`;
}

function buildChannelsQuery(channels: ChannelDef[]): string | undefined {
  const parts = channels
    .map((channel) => channel.q ?? buildAddressQuery(channel.addresses))
    .filter((q): q is string => Boolean(q))
    .map(wrapQueryPart);
  if (parts.length === 0) return undefined;
  return parts.length === 1 ? parts[0] : `(${parts.join(" OR ")})`;
}

const TEST_STORE_CHANNELS: ChannelDef[] = ([
  {
    id: "store-a",
    label: "StoreA",
    addresses: ["shop-a@vtj.co.jp"],
    relatedQ: "store-a",
    replyKind: "rakuten_rms",
    rmsEnvPrefix: "RMS_STORE_A",
  },
  {
    id: "store-b",
    label: "StoreB",
    addresses: ["shop-b@vtj.co.jp"],
    replyKind: "rakuten_rms",
    rmsEnvPrefix: "RMS_STORE_B",
  },
  {
    id: "store-c",
    label: "StoreC",
    addresses: ["shop-c@vtj.co.jp"],
    replyKind: "rakuten_rms",
    rmsEnvPrefix: "RMS_STORE_C",
  },
] satisfies ChannelDef[]).map((channel) => ({ ...channel, q: buildAddressQuery(channel.addresses) }));

const TEST_CHANNELS: ChannelDef[] = [
  { id: "all", label: "All", addresses: [], replyKind: "gmail" },
  {
    id: "stores",
    label: "ストア全部",
    addresses: [],
    q: buildChannelsQuery(TEST_STORE_CHANNELS),
    replyKind: "gmail",
  },
  ...TEST_STORE_CHANNELS,
];

const PROD_STORE_CHANNELS: ChannelDef[] = ([
  {
    id: "cricut-rakuten",
    label: "Cricut 楽天",
    addresses: ["cricut_r@vtj.co.jp"],
    relatedQ: "from:rakuten cricut",
    replyKind: "rakuten_rms",
    rmsEnvPrefix: "RMS_STORE_A",
  },
  {
    id: "cricut-yahoo",
    label: "Cricut Yahoo",
    addresses: ["cricut_y@vtj.co.jp"],
    q: [
      buildAddressQuery(["cricut_y@vtj.co.jp"]),
      "cricut_y@vtj.co.jp",
    ].filter(Boolean).join(" OR "),
    relatedQ: "cricut yahoo",
    replyKind: "gmail",
  },
  {
    id: "cricut-amazon",
    label: "Cricut Amazon",
    addresses: ["cricut_sc@vtj.co.jp"],
    relatedQ: "cricut amazon",
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
    relatedQ: 'from:rakuten.co.jp "gopro"',
    replyKind: "rakuten_rms",
    rmsEnvPrefix: "RMS_STORE_B",
  },
  {
    id: "gopro-yahoo",
    label: "GoPro Yahoo",
    addresses: ["gopro_y@vtj.co.jp", "gopro_order_yahoo@vtj.co.jp"],
    relatedQ: "gopro yahoo",
    replyKind: "gmail",
  },
  {
    id: "gopro-mp",
    label: "GoPro Amazon",
    addresses: ["gopro_mp@vtj.co.jp"],
    relatedQ: "gopro amazon",
    replyKind: "gmail",
  },
  {
    id: "vyperglobal-rakuten",
    label: "VYPER GLOBAL 楽天",
    addresses: ["vyper_r@vtj.co.jp", "vyper_rakuten@vtj.co.jp"],
    relatedQ: 'from:rakuten "VYPER GLOBAL"',
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
    id: "ams-vyper",
    label: "Amazon Ads (AMS)",
    addresses: ["ams_vyper@vtj.co.jp"],
    relatedQ: "amazon ads ams invoice",
    replyKind: "gmail",
  },
  {
    id: "datacolor",
    label: "Datacolor Shopify",
    addresses: ["datacolor_shopify@vtj.co.jp"],
    q: [
      buildAddressQuery(["datacolor_shopify@vtj.co.jp"]),
      "from:datacolor_shopify@vtj.co.jp",
    ].filter(Boolean).join(" OR "),
    relatedQ: "datacolor shopify",
    replyKind: "gmail",
  },
  {
    id: "akg",
    label: "AKGストア",
    addresses: ["akgstore@vtj.co.jp"],
    relatedQ: "akgstore",
    replyKind: "gmail",
  },
  {
    id: "sbd",
    label: "SBD (Black & Decker)",
    addresses: ["sbd@vtj.co.jp"],
    relatedQ: "sbd black decker",
    replyKind: "gmail",
  },
  {
    id: "secondhand",
    label: "セカンドハンド",
    addresses: ["secondhand@vtj.co.jp"],
    relatedQ: "secondhand",
    replyKind: "gmail",
  },
  {
    id: "steiner",
    label: "Steiner Optics",
    addresses: ["steiner-optics_sc@vtj.co.jp"],
    relatedQ: "steiner optics",
    replyKind: "gmail",
  },
  {
    id: "ebay",
    label: "eBay",
    addresses: ["ebay@vtj.co.jp"],
    replyKind: "gmail",
  },
] satisfies ChannelDef[]).map((channel) => {
  if (channel.q) return channel;
  const q = buildAddressQuery(channel.addresses);
  return q ? { ...channel, q } : channel;
});

const PROD_CHANNELS: ChannelDef[] = [
  { id: "all", label: "All", addresses: [], replyKind: "gmail" },
  {
    id: "stores",
    label: "ストア全部",
    addresses: [],
    q: buildChannelsQuery(PROD_STORE_CHANNELS),
    replyKind: "gmail",
  },
  ...PROD_STORE_CHANNELS,
];

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

export function getChannelSourceScope(id: string | undefined, testMode: boolean): ChannelSourceScope | null {
  const channels = getChannels(testMode);
  const channel = channels.find((item) => item.id === id);
  if (!channel || channel.id === "all") return null;
  const sourceChannels =
    channel.id === "stores"
      ? channels.filter((item) => item.id !== "all" && item.id !== "stores")
      : [channel];
  return {
    channel: {
      id: channel.id,
      label: channel.label,
      addresses: channel.addresses,
      relatedQ: channel.relatedQ,
    },
    sourceChannels: sourceChannels.map((item) => ({
      id: item.id,
      label: item.label,
      addresses: item.addresses,
    })),
    sourceAddresses: sourceChannels.flatMap((item) => item.addresses),
    isAggregate: channel.id === "stores",
  };
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
