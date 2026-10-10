import React from 'react';
import { Slot } from 'expo-router';
import { AdminShell } from '@/components/admin/AdminShell';
import { AdminLogin } from '@/components/admin/AdminLogin';
import { useLocal } from '@/store/useLocal';
import { useStore } from '@/store/useStore';

/** Admin guard: needs a mock session AND an existing user with role === 'admin'. */
export default function AdminLayout() {
  const session = useLocal((s) => s.adminSession);
  const isAdmin = useStore((s) => s.users.some((u) => u.role === 'admin'));
  if (!session || !isAdmin) return <AdminLogin forbidden={session && !isAdmin} />;
  return <AdminShell><Slot /></AdminShell>;
}
