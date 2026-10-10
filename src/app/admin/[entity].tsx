import React from 'react';
import { useLocalSearchParams } from 'expo-router';
import { CrudScreen } from '@/components/admin/CrudScreen';
import { ENTITIES } from '@/admin/entities';
import NotFound from '../+not-found';

export default function EntityRoute() {
  const { entity } = useLocalSearchParams<{ entity: string }>();
  if (!ENTITIES[entity]) return <NotFound />;
  return <CrudScreen entity={entity} />;
}
