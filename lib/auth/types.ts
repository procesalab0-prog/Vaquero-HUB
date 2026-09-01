export type WorkspaceIdentity = {
  id: string;
  name: string;
  employeeCode: string;
  role: string;
  roleCode: string;
  locations: Array<{ id: string; name: string; code: string }>;
};
