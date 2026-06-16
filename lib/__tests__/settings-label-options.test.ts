import { describe, expect, test } from "vitest";
import { buildViewChannelOptions, buildViewLabelSelectOptions } from "@/lib/view-label-options";

const baseViewOptionIds = new Set(["todo", "waiting", "muted", "mine", "unassigned", "all"]);

function channelIdsFromSelect(options: Array<{ value: string }>): string[] {
  return options.map((option) => option.value).filter((value) => !baseViewOptionIds.has(value));
}

describe("settings view label options", () => {
  test("testMode=true returns store-a/b/c for both View option selects", () => {
    expect(buildViewChannelOptions(true).map((option) => option.value)).toEqual(["stores", "store-a", "store-b", "store-c"]);

    const options = buildViewLabelSelectOptions(true);
    expect(channelIdsFromSelect(options.newView)).toEqual(["stores", "store-a", "store-b", "store-c"]);
    expect(channelIdsFromSelect(options.editView)).toEqual(["stores", "store-a", "store-b", "store-c"]);
  });

  test("testMode=false returns the aggregate stores channel and 17 production channels for both View option selects", () => {
    const options = buildViewLabelSelectOptions(false);
    const expected = [
      "stores",
      "cricut-rakuten",
      "cricut-yahoo",
      "cricut-amazon",
      "cricut-makeshop",
      "gopro-rakuten",
      "gopro-yahoo",
      "gopro-mp",
      "vyperglobal-rakuten",
      "vyperglobal-yahoo",
      "vyperglobal-amazon",
      "vyper-amazon",
      "datacolor",
      "akg",
      "sbd",
      "secondhand",
      "steiner",
      "ebay",
    ];

    expect(channelIdsFromSelect(options.newView)).toEqual(expected);
    expect(channelIdsFromSelect(options.editView)).toEqual(expected);
    expect(channelIdsFromSelect(options.newView)).toHaveLength(18);
    expect(channelIdsFromSelect(options.editView)).toHaveLength(18);
  });
});
