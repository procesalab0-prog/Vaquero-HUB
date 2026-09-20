export type WorkspaceLocation = {
  id: string;
  name: string;
  code: string;
  labelCode: string;
  address: string | null;
  phone: string | null;
};

export type WorkspaceIdentity = {
  id: string;
  name: string;
  employeeCode: string;
  role: string;
  roleCode: string;
  locations: WorkspaceLocation[];
  openCashSession: {
    locationId: string;
    registerName: string;
  } | null;
};
