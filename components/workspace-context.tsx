"use client";

import { createContext, useContext } from "react";

import type { WorkspaceIdentity, WorkspaceLocation } from "@/lib/auth/types";

type WorkspaceContextValue = {
  identity: WorkspaceIdentity;
  activeLocation: WorkspaceLocation | null;
};

export const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function useWorkspace() {
  const context = useContext(WorkspaceContext);
  if (!context) throw new Error("useWorkspace must be used inside WorkspaceShell");
  return context;
}
