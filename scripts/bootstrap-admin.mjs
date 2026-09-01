import { createClient } from "@supabase/supabase-js";

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Falta la variable ${name}.`);
  return value;
}

const url = required("NEXT_PUBLIC_SUPABASE_URL");
const secretKey = required("SUPABASE_SECRET_KEY");
const email = required("ADMIN_EMAIL").toLowerCase();
const password = required("ADMIN_PASSWORD");
const employeeCode = required("ADMIN_EMPLOYEE_CODE").toUpperCase();
const fullName = required("ADMIN_FULL_NAME");

if (password.length < 12) {
  throw new Error("ADMIN_PASSWORD debe tener al menos 12 caracteres.");
}

const supabase = createClient(url, secretKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const { data: role, error: roleError } = await supabase
  .from("roles")
  .select("id")
  .eq("code", "ADMIN")
  .single();

if (roleError || !role) {
  throw new Error("No se encontró el rol ADMIN. Aplica primero M1.", {
    cause: roleError,
  });
}

const { data: authData, error: authError } =
  await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    app_metadata: { account_type: "employee" },
  });

if (authError || !authData.user) {
  throw new Error("No se pudo crear el usuario de Auth.", {
    cause: authError,
  });
}

const userId = authData.user.id;
const { error: profileError } = await supabase.from("app_users").insert({
  id: userId,
  employee_code: employeeCode,
  full_name: fullName,
  email,
  role_id: role.id,
});

if (profileError) {
  await supabase.auth.admin.deleteUser(userId);
  throw new Error(
    "No se pudo crear el perfil; el usuario de Auth fue eliminado para evitar un registro incompleto.",
    { cause: profileError },
  );
}

process.stdout.write(
  `Administrador inicial creado correctamente (${employeeCode}).\n`,
);
