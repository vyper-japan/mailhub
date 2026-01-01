import { describe, it, expect } from "vitest";
import { extractInquiryNumber, extractOrderNumber } from "../rakuten/extract";

describe("extractInquiryNumber", () => {
  const testCases = [
    {
      name: "標準パターン（全角コロン）",
      text: "問い合わせ番号：12345678",
      expected: "12345678",
    },
    {
      name: "標準パターン（半角コロン）",
      text: "問い合わせ番号: 12345678",
      expected: "12345678",
    },
    {
      name: "お問い合わせ番号（全角）",
      text: "お問い合わせ番号：9876543210",
      expected: "9876543210",
    },
    {
      name: "前後にノイズあり",
      text: "【楽天RMS】お客様からお問い合わせが届きました。\n問い合わせ番号: 12345678\n\nお問い合わせ内容: 商品について",
      expected: "12345678",
    },
    {
      name: "msg-021の実際の本文",
      text: "お客様からお問い合わせが届きました。\n\n問い合わせ番号: 12345678\n\nお客様名: 山田 太郎 様",
      expected: "12345678",
    },
    {
      name: "複数パターン混在（最初のものを返す）",
      text: "問い合わせ番号: 11111111\n別の問い合わせ番号: 22222222",
      expected: "11111111",
    },
    {
      name: "非楽天文面（問い合わせ番号なし）",
      text: "Amazon.co.jp をご利用いただき、ありがとうございます。\n注文番号：123-4567890-1234567",
      expected: null,
    },
    {
      name: "空文字",
      text: "",
      expected: null,
    },
    {
      name: "長文でも落ちない",
      text: "あ".repeat(10000) + "\n問い合わせ番号: 12345678\n" + "い".repeat(10000),
      expected: "12345678",
    },
    {
      name: "8桁以上の数字を探す（フォールバック）",
      text: "お問い合わせがあります。ID: 12345678901234",
      expected: "12345678901234",
    },
  ];

  testCases.forEach(({ name, text, expected }) => {
    it(name, () => {
      const result = extractInquiryNumber(text);
      expect(result).toBe(expected);
    });
  });
});

describe("extractOrderNumber", () => {
  const testCases = [
    {
      name: "標準パターン（全角コロン）",
      text: "注文番号：ORD-2025-12345",
      expected: "ORD-2025-12345",
    },
    {
      name: "標準パターン（半角コロン）",
      text: "注文番号: ORD-2025-12345",
      expected: "ORD-2025-12345",
    },
    {
      name: "ご注文番号",
      text: "ご注文番号：ORD-2025-12345",
      expected: "ORD-2025-12345",
    },
    {
      name: "前後にノイズあり",
      text: "【楽天RMS】\n注文番号: ORD-2025-12345\n\n商品情報",
      expected: "ORD-2025-12345",
    },
    {
      name: "注文ID（数字のみ）",
      text: "注文ID: 12345678",
      expected: "12345678",
    },
    {
      name: "注文番号なし",
      text: "問い合わせ番号: 12345678",
      expected: null,
    },
    {
      name: "空文字",
      text: "",
      expected: null,
    },
  ];

  testCases.forEach(({ name, text, expected }) => {
    it(name, () => {
      const result = extractOrderNumber(text);
      expect(result).toBe(expected);
    });
  });
});

