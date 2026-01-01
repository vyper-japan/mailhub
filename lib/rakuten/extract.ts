/**
 * 楽天RMS用のコンテキスト抽出ユーティリティ
 */

/**
 * 問い合わせ番号を抽出する
 * 例: "問い合わせ番号: 12345678" → "12345678"
 * @param text メール本文
 * @returns 問い合わせ番号（見つからない場合はnull）
 */
export function extractInquiryNumber(text: string): string | null {
  if (!text) return null;

  // パターン1: "問い合わせ番号: 12345678"
  const pattern1 = /問い合わせ番号[：:]\s*(\d+)/i;
  const match1 = text.match(pattern1);
  if (match1 && match1[1]) {
    return match1[1].trim();
  }

  // パターン2: "問い合わせID: 12345678"
  const pattern2 = /問い合わせID[：:]\s*(\d+)/i;
  const match2 = text.match(pattern2);
  if (match2 && match2[1]) {
    return match2[1].trim();
  }

  // パターン3: "お問い合わせ番号: 12345678"
  const pattern3 = /お問い合わせ番号[：:]\s*(\d+)/i;
  const match3 = text.match(pattern3);
  if (match3 && match3[1]) {
    return match3[1].trim();
  }

  // パターン4: "Inquiry Number: 12345678"
  const pattern4 = /inquiry\s+number[：:]\s*(\d+)/i;
  const match4 = text.match(pattern4);
  if (match4 && match4[1]) {
    return match4[1].trim();
  }

  // パターン5: 8桁以上の数字を探す（問い合わせ番号の可能性）
  const pattern5 = /\b(\d{8,})\b/;
  const match5 = text.match(pattern5);
  if (match5 && match5[1]) {
    return match5[1].trim();
  }

  return null;
}

/**
 * 注文番号を抽出する
 * @param text メール本文
 * @returns 注文番号（見つからない場合はnull）
 */
export function extractOrderNumber(text: string): string | null {
  if (!text) return null;

  // パターン1: "注文番号: ORD-2025-001"
  const pattern1 = /注文番号[：:]\s*([A-Z0-9\-]+)/i;
  const match1 = text.match(pattern1);
  if (match1 && match1[1]) {
    return match1[1].trim();
  }

  // パターン2: "Order Number: ORD-2025-001"
  const pattern2 = /order\s+number[：:]\s*([A-Z0-9\-]+)/i;
  const match2 = text.match(pattern2);
  if (match2 && match2[1]) {
    return match2[1].trim();
  }

  // パターン3: "注文ID: 12345678"
  const pattern3 = /注文ID[：:]\s*(\d+)/i;
  const match3 = text.match(pattern3);
  if (match3 && match3[1]) {
    return match3[1].trim();
  }

  return null;
}

