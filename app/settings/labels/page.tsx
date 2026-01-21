import { requireUser } from "@/lib/require-user";
import { SettingsPanel } from "./settings-panel";

export const dynamic = "force-dynamic";

export default async function LabelsSettingsPage() {
  const auth = await requireUser();
  if (!auth.ok) {
    return (
      <div className="p-8">
        <h1 className="text-xl font-semibold mb-2">ラベル設定</h1>
        <p className="text-sm text-gray-600">ログインが必要です。</p>
      </div>
    );
  }

  return <SettingsPanel mode="page" />;
}



