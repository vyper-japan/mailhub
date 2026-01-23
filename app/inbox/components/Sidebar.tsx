"use client";

import type { ChannelCounts, StatusCounts } from "@/lib/mailhub-types";
import type { LabelGroup, LabelItem } from "@/lib/labels";
import type { View } from "@/lib/views";
import { Inbox, Clock, VolumeX, User, UserCheck, LogOut, Timer } from "lucide-react";
import { t } from "../inbox-ui";

type TeamMember = { email: string; name: string | null };

type Props = {
  sidebarWidth: number;
  labelId: string;
  viewTab: "inbox" | "assigned" | "waiting" | "muted" | "snoozed";
  glowTab: string | null;
  labelGroups: LabelGroup[];
  views: View[];
  activeViewId: string | null;
  testMode: boolean;
  messagesLength: number;
  channelCounts: ChannelCounts;
  statusCounts: StatusCounts | null;
  user: { email: string; name: string };
  version: string | null;
  logoutAction: () => Promise<void>;
  onSelectLabel: (item: LabelItem) => void;
  onAssignedStatusClick: () => void;
  onSelectView: (id: string) => void;
  // Step 64: Team View
  team: TeamMember[];
  isAdmin: boolean;
  activeAssigneeSlug: string | null;
  onSelectTeamMember: (email: string) => void;
};

export function Sidebar({
  sidebarWidth,
  labelId,
  viewTab,
  glowTab,
  labelGroups,
  views,
  activeViewId,
  testMode,
  messagesLength,
  channelCounts,
  statusCounts,
  user,
  version,
  logoutAction,
  onSelectLabel,
  onAssignedStatusClick,
  onSelectView,
  team,
  isAdmin,
  activeAssigneeSlug,
  onSelectTeamMember,
}: Props) {
  const pinnedViews = views.filter((v) => v.pinned).sort((a, b) => a.order - b.order);
  const otherViews = views.filter((v) => !v.pinned).sort((a, b) => a.order - b.order);
  return (
    <aside
      className={t.sidebar}
      style={{ width: `${sidebarWidth}px`, minWidth: "200px", maxWidth: "320px" }}
    >
      <div className="p-4 h-14 flex items-center">
        <div className="flex items-center gap-2 font-bold text-lg tracking-tight text-gray-900">
          <Inbox size={20} className="text-blue-600" />
          <span>MailHub</span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto py-2">
        {/* Views（保存ビュー） */}
        {views.length > 0 && (
          <div className="mb-6" data-testid="nav-views">
            <div className={t.sidebarHeader}>Views</div>
            <div className="space-y-0.5">
              {pinnedViews.map((v) => {
                const isActive = v.id === activeViewId;
                return (
                  <div
                    key={v.id}
                    data-testid={`view-item-${v.id}`}
                    onClick={() => onSelectView(v.id)}
                    className={`${t.sidebarItem} ${isActive ? t.sidebarItemActive : ""}`}
                    title={v.id}
                  >
                    <span className="flex items-center gap-2 min-w-0">
                      <span className={`w-1.5 h-1.5 rounded-full ${isActive ? "bg-[#1a73e8]" : "bg-[#dadce0]"}`} />
                      <span className="truncate">{v.icon ? `${v.icon} ` : ""}{v.name}</span>
                    </span>
                  </div>
                );
              })}
              {otherViews.length > 0 && (
                <details className="mt-2">
                  <summary className="cursor-pointer text-[12px] text-[#5f6368] px-3 py-2 hover:bg-[#f1f3f4] rounded">
                    もっと表示（{otherViews.length}）
                  </summary>
                  <div className="space-y-0.5 mt-1">
                    {otherViews.map((v) => {
                      const isActive = v.id === activeViewId;
                      return (
                        <div
                          key={v.id}
                          data-testid={`view-item-${v.id}`}
                          onClick={() => onSelectView(v.id)}
                          className={`${t.sidebarItem} ${isActive ? t.sidebarItemActive : ""}`}
                          title={v.id}
                        >
                          <span className="flex items-center gap-2 min-w-0">
                            <span className={`w-1.5 h-1.5 rounded-full ${isActive ? "bg-[#1a73e8]" : "bg-[#dadce0]"}`} />
                            <span className="truncate">{v.icon ? `${v.icon} ` : ""}{v.name}</span>
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </details>
              )}
            </div>
          </div>
        )}

        {/* Channelsセクション（テストモードのみ表示） */}
        {testMode &&
          labelGroups
            .filter((g) => g.id === "channels")
            .map((group) => (
              <div key={group.id} className="mb-6" data-testid="label-channels">
                <div className={t.sidebarHeader}>{group.label}</div>
                <div className="space-y-0.5">
                  {group.items.map((item) => {
                    const isActive = item.id === labelId;
                    let count: number | null = null;
                    if (item.type === "channel") {
                      // 常に保持しているchannelCountsを表示（画面移動で消えない）
                      count = typeof channelCounts[item.id] === "number" ? channelCounts[item.id] : null;
                      // 初回など未取得の場合は、アクティブ時のみ現在のmessages長で補完
                      if (count === null && isActive) count = messagesLength;
                    }

                    return (
                      <div
                        key={item.id}
                        data-testid={`label-item-${item.id}`}
                        onClick={() => onSelectLabel(item)}
                        className={`${t.sidebarItem} ${isActive ? t.sidebarItemActive : ""}`}
                      >
                        <span className="flex items-center gap-2">
                          <span
                            className={`w-1.5 h-1.5 rounded-full ${isActive ? "bg-[#1a73e8]" : "bg-[#dadce0]"}`}
                          ></span>
                          <span>{item.label}</span>
                        </span>
                        {count !== null && count > 0 && <span className={t.badge}>{count}</span>}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}

        {/* Statusセクション: 受信箱、担当、保留、低優先（Doneを除外） */}
        <div className="mb-6" data-testid="label-status">
          <div className={t.sidebarHeader}>Status</div>
          <div className="space-y-0.5">
            {/* 受信箱（Todo） */}
            {(() => {
              const item = labelGroups.flatMap((g) => g.items).find((i) => i.statusType === "todo");
              if (!item) return null;
              const isActive = viewTab === "inbox" && item.id === labelId;
              const count = statusCounts?.todo ?? null;
              return (
                <div
                  key={item.id}
                  data-testid={`label-item-${item.id}`}
                  onClick={() => onSelectLabel(item)}
                  className={`${t.sidebarItem} ${isActive ? t.sidebarItemActive : ""} ${
                    glowTab === item.statusType
                      ? "ring-2 ring-[#1a73e8]/60 shadow-[0_0_0_6px_rgba(26,115,232,0.18)] animate-pulse bg-[#E8F0FE]"
                      : ""
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <Inbox
                      size={20}
                      className={`${isActive ? "text-[#1a73e8]" : "text-[#5f6368]"} ${
                        glowTab === item.statusType ? "drop-shadow-[0_0_10px_rgba(26,115,232,0.55)]" : ""
                      }`}
                    />
                    <span className={glowTab === item.statusType ? "text-[#1a73e8] font-medium" : ""}>
                      受信箱
                    </span>
                  </span>
                  {count !== null && count > 0 && (
                    <span
                      className={`${t.badge} ${
                        glowTab === item.statusType
                          ? "bg-[#E8F0FE] text-[#1a73e8] border border-[#d2e3fc] shadow-[0_0_10px_rgba(26,115,232,0.35)] animate-pulse scale-110"
                          : ""
                      }`}
                    >
                      {count}
                    </span>
                  )}
                </div>
              );
            })()}

            {/* 担当（assigned） */}
            {(() => {
              const isActive = viewTab === "assigned";
              const count = statusCounts?.assignedMine ?? 0;
              return (
                <div
                  key="assigned"
                  data-testid="label-item-assigned"
                  onClick={onAssignedStatusClick}
                  className={`${t.sidebarItem} ${isActive ? t.sidebarItemActive : ""} ${
                    glowTab === "assigned"
                      ? "ring-2 ring-[#1a73e8]/60 shadow-[0_0_0_6px_rgba(26,115,232,0.18)] animate-pulse bg-[#E8F0FE]"
                      : ""
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <UserCheck
                      size={20}
                      className={`${isActive ? "text-[#1a73e8]" : "text-[#5f6368]"} ${
                        glowTab === "assigned" ? "drop-shadow-[0_0_10px_rgba(26,115,232,0.55)]" : ""
                      }`}
                    />
                    <span className={glowTab === "assigned" ? "text-[#1a73e8] font-medium" : ""}>担当</span>
                  </span>
                  {count > 0 && (
                    <span
                      className={`${t.badge} ${
                        glowTab === "assigned"
                          ? "bg-[#E8F0FE] text-[#1a73e8] border border-[#d2e3fc] shadow-[0_0_10px_rgba(26,115,232,0.35)] animate-pulse scale-110"
                          : ""
                      }`}
                    >
                      {count}
                    </span>
                  )}
                </div>
              );
            })()}

            {/* 保留（Waiting） */}
            {(() => {
              const item = labelGroups.flatMap((g) => g.items).find((i) => i.statusType === "waiting");
              if (!item) return null;
              const isActive = viewTab === "waiting" && item.id === labelId;
              const count = statusCounts?.waiting ?? null;
              return (
                <div
                  key={item.id}
                  data-testid={`label-item-${item.id}`}
                  onClick={() => onSelectLabel(item)}
                  className={`${t.sidebarItem} ${isActive ? t.sidebarItemActive : ""} ${
                    glowTab === item.statusType
                      ? "ring-2 ring-[#1a73e8]/60 shadow-[0_0_0_6px_rgba(26,115,232,0.18)] animate-pulse bg-[#E8F0FE]"
                      : ""
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <Clock
                      size={20}
                      className={`${isActive ? "text-[#1a73e8]" : "text-[#5f6368]"} ${
                        glowTab === item.statusType ? "drop-shadow-[0_0_10px_rgba(26,115,232,0.55)]" : ""
                      }`}
                    />
                    <span className={glowTab === item.statusType ? "text-[#1a73e8] font-medium" : ""}>
                      保留
                    </span>
                  </span>
                  {count !== null && count > 0 && (
                    <span
                      className={`${t.badge} ${
                        glowTab === item.statusType
                          ? "bg-[#E8F0FE] text-[#1a73e8] border border-[#d2e3fc] shadow-[0_0_10px_rgba(26,115,232,0.35)] animate-pulse scale-110"
                          : ""
                      }`}
                    >
                      {count}
                    </span>
                  )}
                </div>
              );
            })()}

            {/* 低優先（Muted） */}
            {(() => {
              const item = labelGroups.flatMap((g) => g.items).find((i) => i.statusType === "muted");
              if (!item) return null;
              const isActive = viewTab === "muted" && item.id === labelId;
              const count = statusCounts?.muted ?? null;
              return (
                <div
                  key={item.id}
                  data-testid={`label-item-${item.id}`}
                  onClick={() => onSelectLabel(item)}
                  className={`${t.sidebarItem} ${isActive ? t.sidebarItemActive : ""} ${
                    glowTab === item.statusType
                      ? "ring-2 ring-[#1a73e8]/60 shadow-[0_0_0_6px_rgba(26,115,232,0.18)] animate-pulse bg-[#E8F0FE]"
                      : ""
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <VolumeX
                      size={20}
                      className={`${isActive ? "text-[#1a73e8]" : "text-[#5f6368]"} ${
                        glowTab === item.statusType ? "drop-shadow-[0_0_10px_rgba(26,115,232,0.55)]" : ""
                      }`}
                    />
                    <span className={glowTab === item.statusType ? "text-[#1a73e8] font-medium" : ""}>
                      低優先
                    </span>
                  </span>
                  {count !== null && count > 0 && (
                    <span
                      className={`${t.badge} ${
                        glowTab === item.statusType
                          ? "bg-[#E8F0FE] text-[#1a73e8] border border-[#d2e3fc] shadow-[0_0_10px_rgba(26,115,232,0.35)] animate-pulse scale-110"
                          : ""
                      }`}
                    >
                      {count}
                    </span>
                  )}
                </div>
              );
            })()}

            {/* Snoozed（期限付き保留） */}
            {(() => {
              const item = labelGroups.flatMap((g) => g.items).find((i) => i.statusType === "snoozed");
              if (!item) return null;
              const isActive = viewTab === "snoozed" && item.id === labelId;
              const count = statusCounts?.snoozed ?? null;
              return (
                <div
                  key={item.id}
                  data-testid={`label-item-${item.id}`}
                  onClick={() => onSelectLabel(item)}
                  className={`${t.sidebarItem} ${isActive ? t.sidebarItemActive : ""} ${
                    glowTab === item.statusType
                      ? "ring-2 ring-[#1a73e8]/60 shadow-[0_0_0_6px_rgba(26,115,232,0.18)] animate-pulse bg-[#E8F0FE]"
                      : ""
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <Timer
                      size={20}
                      className={`${isActive ? "text-[#1a73e8]" : "text-[#5f6368]"} ${
                        glowTab === item.statusType ? "drop-shadow-[0_0_10px_rgba(26,115,232,0.55)]" : ""
                      }`}
                    />
                    <span className={glowTab === item.statusType ? "text-[#1a73e8] font-medium" : ""}>
                      期限付き保留
                    </span>
                  </span>
                  {count !== null && count > 0 && (
                    <span
                      className={`${t.badge} ${
                        glowTab === item.statusType
                          ? "bg-[#E8F0FE] text-[#1a73e8] border border-[#d2e3fc] shadow-[0_0_10px_rgba(26,115,232,0.35)] animate-pulse scale-110"
                          : ""
                      }`}
                    >
                      {count}
                    </span>
                  )}
                </div>
              );
            })()}
          </div>
        </div>

        {/* Step 113: Assigneeセクション（Mine/Unassigned + 全メンバー） */}
        {labelGroups
          .filter((g) => g.id === "assignee")
          .map((group) => {
            // Step 65: MineのslugはuserのemailからSlugを作成
            const mineSlug = user.email.replace("@", "_at_").replace(/\./g, "_");
            const mineLoad = statusCounts?.assigneeLoadBySlug?.[mineSlug] ?? 0;
            const unassignedLoad = statusCounts?.unassignedLoad ?? 0;
            // Step 113: ログインユーザーの表示名をAssigneesから取得
            const myAssignee = team.find((m) => m.email.toLowerCase() === user.email.toLowerCase());
            const myDisplayName = myAssignee?.name || user.name?.split(" ")[0] || user.email.split("@")[0];
            return (
            <div key={group.id} className="mb-6" data-testid="label-assignee">
              <div className={t.sidebarHeader}>{group.label}</div>
              <div className="space-y-0.5">
                {/* Mine / Unassigned */}
                {group.items.map((item) => {
                  const isActive = item.id === labelId && !activeAssigneeSlug;
                  // Step 65: Mine/Unassignedの件数バッジ
                  const count = item.id === "mine" ? mineLoad : item.id === "unassigned" ? unassignedLoad : 0;
                  const countTestId = item.id === "mine" ? "assignee-count-mine" : item.id === "unassigned" ? "assignee-count-unassigned" : undefined;
                  // Step 113: 「自分」→「Mine(表示名)」に変更
                  const displayLabel = item.id === "mine" ? `Mine (${myDisplayName})` : item.label;
                  return (
                    <div
                      key={item.id}
                      data-testid={`label-item-${item.id}`}
                      onClick={() => onSelectLabel(item)}
                      className={`${t.sidebarItem} ${isActive ? t.sidebarItemActive : ""}`}
                    >
                      <span className="flex items-center gap-2">
                        <User size={20} className={isActive ? "text-[#1a73e8]" : "text-[#5f6368]"} />
                        <span>{displayLabel}</span>
                      </span>
                      {count > 0 && countTestId && (
                        <span data-testid={countTestId} className={t.badge}>{count}</span>
                      )}
                    </div>
                  );
                })}
                {/* Step 113: Team全メンバーをAssigneeセクションに追加 */}
                {team.map((member) => {
                  const memberSlug = member.email.replace("@", "_at_").replace(/\./g, "_");
                  const isActive = activeAssigneeSlug === memberSlug;
                  const displayName = member.name || member.email.split("@")[0];
                  const memberLoad = statusCounts?.assigneeLoadBySlug?.[memberSlug] ?? 0;
                  return (
                    <div
                      key={member.email}
                      data-testid={`assignee-item-${member.email}`}
                      onClick={() => onSelectTeamMember(member.email)}
                      className={`${t.sidebarItem} ${isActive ? t.sidebarItemActive : ""}`}
                    >
                      <span className="flex items-center gap-2">
                        <UserCheck size={20} className={isActive ? "text-[#1a73e8]" : "text-[#5f6368]"} />
                        <span className="truncate">{displayName}</span>
                      </span>
                      {memberLoad > 0 && (
                        <span data-testid={`assignee-count-${memberSlug}`} className={t.badge}>{memberLoad}</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );})}

        {/* Step 64: Team セクション（admin only・自分以外のメンバーのみ表示） */}
        {(isAdmin || testMode) && team.filter((m) => m.email.toLowerCase() !== user.email.toLowerCase()).length > 0 && (
          <div className="mb-6" data-testid="sidebar-team">
            <div className={t.sidebarHeader}>Team</div>
            <div className="space-y-0.5">
              {team
                .filter((m) => m.email.toLowerCase() !== user.email.toLowerCase())
                .map((member) => {
                const memberSlug = member.email.replace("@", "_at_").replace(/\./g, "_");
                const isActive = activeAssigneeSlug === memberSlug;
                const displayName = member.name || member.email.split("@")[0];
                // Step 65: Team担当別の件数バッジ
                const memberLoad = statusCounts?.assigneeLoadBySlug?.[memberSlug] ?? 0;
                return (
                  <div
                    key={member.email}
                    data-testid={`team-member-item-${member.email}`}
                    onClick={() => onSelectTeamMember(member.email)}
                    className={`${t.sidebarItem} ${isActive ? t.sidebarItemActive : ""}`}
                  >
                    <span className="flex items-center gap-2">
                      <UserCheck size={20} className={isActive ? "text-[#1a73e8]" : "text-[#5f6368]"} />
                      <span className="truncate">{displayName}</span>
                    </span>
                    {memberLoad > 0 && (
                      <span data-testid={`assignee-count-${memberSlug}`} className={t.badge}>{memberLoad}</span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <div className="p-4 border-t border-[#dadce0]">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-[#1a73e8] flex items-center justify-center text-[12px] font-medium text-white">
            {user.name.slice(0, 2).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-medium text-[#202124] truncate text-[13px]">{user.name}</div>
            <div className="text-[#5f6368] text-[11px] truncate font-normal">{user.email}</div>
          </div>
          {!testMode && (
            <form action={logoutAction}>
              <button
                type="submit"
                className="p-1 text-[#5f6368] hover:text-[#c5221f] transition-colors cursor-pointer"
                title="ログアウト"
              >
                <LogOut size={18} />
              </button>
            </form>
          )}
        </div>
        {version && (
          <div className="mt-2 pt-2 border-t border-[#dadce0]">
            <div
              className="text-[10px] text-[#5f6368] font-mono truncate font-normal"
              title={`Version: ${version}`}
            >
              v{version}
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}




