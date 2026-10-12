import React from 'react';
import { useLocalSearchParams } from 'expo-router';
import { CrudScreen } from '@/components/admin/CrudScreen';
import { ENTITIES } from '@/admin/entities';
import { useStore } from '@/store/useStore';
import NotFound from '../+not-found';

export default function EntityRoute() {
  const { entity } = useLocalSearchParams<{ entity: string }>();
  const bulk = useStore((s) => s.doc.settings.bulkPanels?.includes(entity) ?? false);
  if (!ENTITIES[entity]) return <NotFound />;
  return <CrudScreen key={`${entity}-${bulk}`} entity={entity} />;
}
