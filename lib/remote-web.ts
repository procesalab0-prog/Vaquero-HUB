export type RemoteWebState = {
  enabled: boolean;
  eligible: boolean;
  reason?: string | null;
  job: null | {
    id: string;
    state: string;
    revision: number;
    remote_product_id: number | null;
  };
};
export type RemoteWebResult = { remote?: RemoteWebState; error?: string };
