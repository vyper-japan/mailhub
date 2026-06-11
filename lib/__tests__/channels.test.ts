import { describe, expect, test } from "vitest";
import {
  buildAddressQuery,
  coerceChannelId,
  getChannels,
  getRmsEnvPrefix,
  type ChannelDef,
} from "@/lib/channels";
import { buildLabelGroups, getDefaultLabel, getLabelById, getLabelQuery, LABEL_GROUPS } from "@/lib/labels";

const testChannels: ChannelDef[] = [
  { id: "all", label: "All", addresses: [], replyKind: "gmail" },
  {
    id: "store-a",
    label: "StoreA",
    addresses: ["shop-a@vtj.co.jp"],
    q: "(deliveredto:shop-a@vtj.co.jp OR to:shop-a@vtj.co.jp OR cc:shop-a@vtj.co.jp)",
    replyKind: "rakuten_rms",
    rmsEnvPrefix: "RMS_STORE_A",
  },
  {
    id: "store-b",
    label: "StoreB",
    addresses: ["shop-b@vtj.co.jp"],
    q: "(deliveredto:shop-b@vtj.co.jp OR to:shop-b@vtj.co.jp OR cc:shop-b@vtj.co.jp)",
    replyKind: "rakuten_rms",
    rmsEnvPrefix: "RMS_STORE_B",
  },
  {
    id: "store-c",
    label: "StoreC",
    addresses: ["shop-c@vtj.co.jp"],
    q: "(deliveredto:shop-c@vtj.co.jp OR to:shop-c@vtj.co.jp OR cc:shop-c@vtj.co.jp)",
    replyKind: "rakuten_rms",
    rmsEnvPrefix: "RMS_STORE_C",
  },
];

const prodChannels = [
  {
    id: "cricut-rakuten",
    label: "Cricut 楽天",
    addresses: ["cricut_r@vtj.co.jp"],
  },
  {
    id: "cricut-yahoo",
    label: "Cricut Yahoo",
    addresses: ["cricut_y@vtj.co.jp"],
  },
  {
    id: "cricut-amazon",
    label: "Cricut Amazon",
    addresses: ["cricut_sc@vtj.co.jp"],
  },
  {
    id: "cricut-makeshop",
    label: "Cricut オンラインストア",
    addresses: ["cricut_makeshop@vtj.co.jp"],
  },
  {
    id: "gopro-rakuten",
    label: "GoPro 楽天",
    addresses: [
      "gopro_r@vtj.co.jp",
      "gopro_order_rakuten@vtj.co.jp",
      "gopro_rakuten@vtj.co.jp",
    ],
  },
  {
    id: "gopro-yahoo",
    label: "GoPro Yahoo",
    addresses: ["gopro_y@vtj.co.jp", "gopro_order_yahoo@vtj.co.jp"],
  },
  {
    id: "gopro-mp",
    label: "GoPro MP",
    addresses: ["gopro_mp@vtj.co.jp"],
  },
  {
    id: "vyperglobal-rakuten",
    label: "VYPER GLOBAL 楽天",
    addresses: ["vyper_r@vtj.co.jp", "vyper_rakuten@vtj.co.jp"],
  },
  {
    id: "vyperglobal-yahoo",
    label: "VYPER GLOBAL Yahoo",
    addresses: ["vyperglobal_y@vtj.co.jp"],
  },
  {
    id: "vyperglobal-amazon",
    label: "VYPER GLOBAL Amazon",
    addresses: ["vyperglobal_sc@vtj.co.jp"],
  },
  {
    id: "vyper-amazon",
    label: "VYPER SC",
    addresses: ["vyper_sc@vtj.co.jp"],
  },
  {
    id: "datacolor",
    label: "Datacolor Shopify",
    addresses: ["datacolor_shopify@vtj.co.jp"],
  },
  {
    id: "akg",
    label: "AKGストア",
    addresses: ["akgstore@vtj.co.jp"],
  },
  {
    id: "sbd",
    label: "SBD (Black & Decker)",
    addresses: ["sbd@vtj.co.jp"],
  },
  {
    id: "secondhand",
    label: "セカンドハンド",
    addresses: ["secondhand@vtj.co.jp"],
  },
  {
    id: "steiner",
    label: "Steiner Optics",
    addresses: ["steiner-optics_sc@vtj.co.jp"],
  },
  {
    id: "ebay",
    label: "eBay",
    addresses: ["ebay@vtj.co.jp"],
  },
];

describe("channels", () => {
  test("getChannels(true) preserves the TEST store fixture", () => {
    expect(getChannels(true)).toEqual(testChannels);
  });

  test("buildLabelGroups(true) preserves the existing LABEL_GROUPS shape", () => {
    expect(buildLabelGroups(true)).toEqual(LABEL_GROUPS);
    expect(buildLabelGroups(true)).toEqual([
      {
        id: "channels",
        label: "チャンネル",
        collapsible: true,
        defaultCollapsed: false,
        items: [
          { id: "all", label: "すべて", type: "channel" },
          {
            id: "store-a",
            label: "StoreA",
            type: "channel",
            q: "(deliveredto:shop-a@vtj.co.jp OR to:shop-a@vtj.co.jp OR cc:shop-a@vtj.co.jp)",
          },
          {
            id: "store-b",
            label: "StoreB",
            type: "channel",
            q: "(deliveredto:shop-b@vtj.co.jp OR to:shop-b@vtj.co.jp OR cc:shop-b@vtj.co.jp)",
          },
          {
            id: "store-c",
            label: "StoreC",
            type: "channel",
            q: "(deliveredto:shop-c@vtj.co.jp OR to:shop-c@vtj.co.jp OR cc:shop-c@vtj.co.jp)",
          },
        ],
      },
      {
        id: "status",
        label: "ステータス",
        collapsible: true,
        defaultCollapsed: false,
        items: [
          { id: "todo", label: "未対応", type: "status", statusType: "todo" },
          { id: "waiting", label: "保留", type: "status", statusType: "waiting" },
          { id: "done", label: "完了", type: "status", statusType: "done" },
          { id: "muted", label: "低優先", type: "status", statusType: "muted" },
          { id: "snoozed", label: "スヌーズ", type: "status", statusType: "snoozed" },
        ],
      },
      {
        id: "assignee",
        label: "担当者",
        collapsible: true,
        defaultCollapsed: false,
        items: [
          { id: "mine", label: "自分", type: "assignee" },
          { id: "unassigned", label: "未割当", type: "assignee" },
        ],
      },
    ]);
  });

  test("buildLabelGroups(false) derives production channel labels and q only when the channel has a query", () => {
    const groups = buildLabelGroups(false);
    const channels = groups[0].items;

    expect(groups.map((group) => group.id)).toEqual(["channels", "status", "assignee"]);
    expect(channels[0]).toEqual({ id: "all", label: "すべて", type: "channel" });
    expect(channels.find((item) => item.id === "cricut-rakuten")).toEqual({
      id: "cricut-rakuten",
      label: "Cricut 楽天",
      type: "channel",
      q: "to:cricut_r@vtj.co.jp",
    });
    expect(channels.find((item) => item.id === "gopro-rakuten")).toEqual({
      id: "gopro-rakuten",
      label: "GoPro 楽天",
      type: "channel",
      q: "to:(gopro_r@vtj.co.jp OR gopro_order_rakuten@vtj.co.jp OR gopro_rakuten@vtj.co.jp)",
    });
  });

  test("label lookup and query helpers handle hit, miss, channel, and non-channel paths", () => {
    const defaultLabel = getDefaultLabel();
    const storeALabel = getLabelById("store-a");
    const statusLabel = getLabelById("todo");

    expect(defaultLabel).toEqual({ id: "all", label: "すべて", type: "channel" });
    expect(storeALabel).toMatchObject({ id: "store-a", type: "channel" });
    expect(getLabelById(undefined)).toBeNull();
    expect(getLabelById("missing")).toBeNull();
    expect(getLabelQuery(storeALabel!)).toBe(
      "(deliveredto:shop-a@vtj.co.jp OR to:shop-a@vtj.co.jp OR cc:shop-a@vtj.co.jp)",
    );
    expect(getLabelQuery(defaultLabel)).toBeUndefined();
    expect(getLabelQuery(statusLabel!)).toBeUndefined();
  });

  test("label lookup uses the active test/prod channel set", () => {
    expect(getLabelById("cricut-rakuten", false)).toMatchObject({
      id: "cricut-rakuten",
      q: "to:cricut_r@vtj.co.jp",
    });
    expect(getLabelById("store-a", false)).toBeNull();
    expect(getLabelById("store-a", true)).toMatchObject({
      id: "store-a",
      q: "(deliveredto:shop-a@vtj.co.jp OR to:shop-a@vtj.co.jp OR cc:shop-a@vtj.co.jp)",
    });
    expect(getLabelById("cricut-rakuten", true)).toBeNull();
  });

  test("getChannels(false) exposes the 17 production channels", () => {
    const channels = getChannels(false);

    expect(channels[0]).toMatchObject({
      id: "all",
      label: "All",
      addresses: [],
    });
    expect(channels.slice(1).map(({ id, label, addresses }) => ({ id, label, addresses }))).toEqual(
      prodChannels,
    );
  });

  test("buildAddressQuery builds Gmail OR queries from multiple addresses", () => {
    expect(buildAddressQuery([])).toBeUndefined();
    expect(buildAddressQuery(["one@vtj.co.jp"])).toBe("to:one@vtj.co.jp");
    expect(buildAddressQuery(["one@vtj.co.jp", "two@vtj.co.jp"])).toBe(
      "to:(one@vtj.co.jp OR two@vtj.co.jp)",
    );
  });

  test("getRmsEnvPrefix returns prefixes only from the active test/prod channel set", () => {
    expect(getRmsEnvPrefix("store-a", true)).toBe("RMS_STORE_A");
    expect(getRmsEnvPrefix("store-a", false)).toBeUndefined();
    expect(getRmsEnvPrefix("cricut-rakuten", false)).toBe("RMS_STORE_A");
    expect(getRmsEnvPrefix("cricut-rakuten", true)).toBeUndefined();
    expect(getRmsEnvPrefix("gopro-rakuten", false)).toBe("RMS_STORE_B");
    expect(getRmsEnvPrefix("vyperglobal-rakuten", false)).toBe("RMS_STORE_C");
    expect(getRmsEnvPrefix("cricut-yahoo", false)).toBeUndefined();
    expect(getRmsEnvPrefix("ebay", false)).toBeUndefined();
  });

  test("coerceChannelId accepts only the active test/prod channel set", () => {
    expect(coerceChannelId("store-a", true)).toBe("store-a");
    expect(coerceChannelId("cricut-rakuten", true)).toBeUndefined();
    expect(coerceChannelId("cricut-rakuten", false)).toBe("cricut-rakuten");
    expect(coerceChannelId("store-a", false)).toBeUndefined();
    expect(coerceChannelId("todo", false)).toBeUndefined();
    expect(coerceChannelId(undefined, false)).toBeUndefined();
  });
});
