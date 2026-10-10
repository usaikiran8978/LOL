import Ionicons from '@expo/vector-icons/Ionicons';
import { Tabs } from 'expo-router';
import { useTranslation } from 'react-i18next';
import type { IconName } from '../../../src/components';
import { useTheme } from '../../../src/theme/ThemeProvider';
import { elevation } from '../../../src/theme/tokens';

const TABS: Array<{ name: string; label: string; icon: IconName; iconActive: IconName }> = [
  { name: 'home', label: 'tabs.discover', icon: 'flame-outline', iconActive: 'flame' },
  { name: 'matches', label: 'tabs.matches', icon: 'heart-outline', iconActive: 'heart' },
  { name: 'matchmaker', label: 'tabs.matchmaker', icon: 'sparkles-outline', iconActive: 'sparkles' },
  { name: 'dates', label: 'tabs.dates', icon: 'calendar-outline', iconActive: 'calendar' },
  { name: 'profile', label: 'tabs.profile', icon: 'person-circle-outline', iconActive: 'person-circle' },
];

/** The five primary destinations. Secondary features live inside these screens (and the Discover avatar menu). */
export default function TabsLayout() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border, ...elevation.card },
      }}
    >
      {TABS.map((tab) => (
        <Tabs.Screen
          key={tab.name}
          name={tab.name}
          options={{
            title: t(tab.label),
            tabBarAccessibilityLabel: t(tab.label),
            tabBarButtonTestID: `tab-${tab.name}`,
            tabBarIcon: ({ focused, color, size }) => <Ionicons name={focused ? tab.iconActive : tab.icon} size={size} color={focused ? colors.accent : color} />,
          }}
        />
      ))}
    </Tabs>
  );
}
