"use client";

/**
 * SidebarOrgTree — Visual hierarchy tree in the sidebar.
 * Multiple owners each start their own tree at rank 1.
 * Separate trees are visually distinct. Rank is not shown publicly.
 */

import { useState } from "react";
import { ChevronDown, ChevronRight, User } from "lucide-react";
import { cn } from "@/lib/utils";
import { type OrgUser } from "@/lib/hierarchy";

interface SidebarOrgTreeProps {
    orgUsers: OrgUser[];
}

// Tree colors for distinct trees (one per owner)
const treeAccents = [
    { bg: "bg-teal-50", border: "border-teal-200", dot: "bg-teal-500", line: "bg-teal-200" },
    { bg: "bg-violet-50", border: "border-violet-200", dot: "bg-violet-500", line: "bg-violet-200" },
    { bg: "bg-amber-50", border: "border-amber-200", dot: "bg-amber-500", line: "bg-amber-200" },
    { bg: "bg-blue-50", border: "border-blue-200", dot: "bg-blue-500", line: "bg-blue-200" },
];

interface TreeNode {
    user: OrgUser;
    children: TreeNode[];
}

function buildTrees(users: OrgUser[]): TreeNode[] {
    const userMap = new Map<string, OrgUser>();
    const childrenMap = new Map<string, OrgUser[]>();

    for (const u of users) {
        userMap.set(u.id, u);
        if (u.reporting_manager_id) {
            const siblings = childrenMap.get(u.reporting_manager_id) || [];
            siblings.push(u);
            childrenMap.set(u.reporting_manager_id, siblings);
        }
    }

    function buildNode(user: OrgUser): TreeNode {
        const kids = (childrenMap.get(user.id) || []).map(buildNode);
        return { user, children: kids };
    }

    // Roots = users with no reporting_manager_id
    const roots = users.filter(u => !u.reporting_manager_id);
    return roots.map(buildNode);
}

export default function SidebarOrgTree({ orgUsers }: SidebarOrgTreeProps) {
    const trees = buildTrees(orgUsers);

    if (trees.length === 0) {
        return <p className="text-[11px] text-gray-400 px-2 py-1.5">No organisation data</p>;
    }

    return (
        <div className="space-y-3">
            {trees.map((tree, i) => (
                <div
                    key={tree.user.id}
                    className={cn("rounded-xl border p-2", treeAccents[i % treeAccents.length].bg, treeAccents[i % treeAccents.length].border)}
                >
                    <TreeNodeView node={tree} depth={0} accentIndex={i} />
                </div>
            ))}
        </div>
    );
}

function TreeNodeView({ node, depth, accentIndex }: { node: TreeNode; depth: number; accentIndex: number }) {
    const [expanded, setExpanded] = useState(depth < 2);
    const accent = treeAccents[accentIndex % treeAccents.length];
    const hasChildren = node.children.length > 0;

    return (
        <div>
            <button
                onClick={() => hasChildren && setExpanded(!expanded)}
                className={cn(
                    "w-full flex items-center gap-2 py-1.5 px-1 rounded-lg transition-colors text-left",
                    hasChildren ? "hover:bg-white/60 cursor-pointer" : "cursor-default"
                )}
                style={{ paddingLeft: `${depth * 12 + 4}px` }}
            >
                {/* Expand icon or dot */}
                {hasChildren ? (
                    expanded
                        ? <ChevronDown className="w-3 h-3 text-gray-400 shrink-0" />
                        : <ChevronRight className="w-3 h-3 text-gray-400 shrink-0" />
                ) : (
                    <span className={cn("w-2 h-2 rounded-full shrink-0", accent.dot)} />
                )}

                {/* Avatar */}
                <div className="w-5 h-5 rounded-md bg-white/80 flex items-center justify-center shrink-0 border border-gray-200/50">
                    <User className="w-3 h-3 text-gray-500" />
                </div>

                {/* Name */}
                <span className="text-[11px] font-semibold text-gray-700 truncate flex-1">
                    {node.user.name}
                </span>

                {/* Role badge */}
                {node.user.role && node.user.role !== "member" && (
                    <span className="text-[9px] font-bold uppercase tracking-wider text-gray-400 bg-white/60 px-1.5 py-0.5 rounded-md shrink-0">
                        {node.user.role}
                    </span>
                )}
            </button>

            {/* Children */}
            {expanded && hasChildren && (
                <div className="relative">
                    {/* Vertical connecting line */}
                    <div
                        className={cn("absolute w-0.5 rounded-full", accent.line)}
                        style={{ left: `${depth * 12 + 10}px`, top: 0, bottom: 8 }}
                    />
                    {node.children.map(child => (
                        <TreeNodeView
                            key={child.user.id}
                            node={child}
                            depth={depth + 1}
                            accentIndex={accentIndex}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}
