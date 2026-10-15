import React, { useMemo, useRef, useState } from 'react';
import { Modal, Pressable, Text, TextInput, TouchableOpacity, View } from 'react-native';
import {
  Heart,
  MoreVertical,
  Search,
  ShoppingBag,
  SlidersHorizontal,
  Store,
  X,
} from 'lucide-react-native';
import { useThemeColors } from '../contexts/ThemeContext';
import { useTranslation } from '../contexts/LocaleContext';
import { createMessagesScreenStyles } from '../styles/MessagesScreen.styles';
import { createChatToolsStyles } from '../styles/ChatTools.styles';
import { createMarketHeaderStyles } from '../styles/MarketHeader.styles';
import type { ExploreNavigation } from '../navigation/types';

interface Props {
  query: string;
  onChangeQuery: (query: string) => void;
  filtersActive: boolean;
  activeFilterCount: number;
  onOpenFilters: () => void;
  navigation: ExploreNavigation;
  payNow: number;
}

export default function MarketHeaderActions({
  query,
  onChangeQuery,
  filtersActive,
  activeFilterCount,
  onOpenFilters,
  navigation,
  payNow,
}: Props) {
  const colors = useThemeColors();
  const t = useTranslation();
  const messages = useMemo(() => createMessagesScreenStyles(colors), [colors]);
  const styles = useMemo(() => createMarketHeaderStyles(colors), [colors]);
  const menu = useMemo(() => createChatToolsStyles(colors), [colors]);
  const [searchExpanded, setSearchExpanded] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const searchInputRef = useRef<TextInput>(null);
  const closeMenu = () => setMenuOpen(false);

  return (
    <View style={styles.actions}>
      <View style={messages.chipRow}>
        {searchExpanded ? (
          <View style={messages.searchRow}>
            <Search size={16} color="rgba(255,255,255,0.7)" strokeWidth={2} />
            <TextInput
              ref={searchInputRef}
              style={messages.searchInput}
              value={query}
              onChangeText={onChangeQuery}
              placeholder={t('market.screen.searchPlaceholder')}
              placeholderTextColor="rgba(255,255,255,0.5)"
              accessibilityLabel={t('market.screen.searchPlaceholder')}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="search"
              testID="market-search-input"
            />
            <TouchableOpacity
              onPress={() => {
                onChangeQuery('');
                setSearchExpanded(false);
              }}
              accessibilityLabel={t('messagesScreen.closeSearch')}
              accessibilityRole="button"
              testID="market-search-clear"
              hitSlop={8}
            >
              <X size={16} color="rgba(255,255,255,0.8)" strokeWidth={2.5} />
            </TouchableOpacity>
          </View>
        ) : (
          <>
            <View style={styles.spacer} />
            <TouchableOpacity
              style={messages.searchToggle}
              onPress={() => {
                setSearchExpanded(true);
                setTimeout(() => searchInputRef.current?.focus(), 100);
              }}
              accessibilityLabel={t('market.screen.searchPlaceholder')}
              accessibilityRole="button"
              accessibilityState={{ expanded: false }}
              testID="market-header-search"
            >
              <Search size={18} color="rgba(255,255,255,0.8)" strokeWidth={2} />
            </TouchableOpacity>
          </>
        )}
        <TouchableOpacity
          style={[messages.searchToggle, filtersActive && styles.activeButton]}
          onPress={onOpenFilters}
          accessibilityLabel={
            filtersActive
              ? t('market.screen.filtersApplied', { count: activeFilterCount })
              : t('market.screen.filters')
          }
          accessibilityRole="button"
          accessibilityState={{ selected: filtersActive }}
          testID="market-filter-button"
        >
          <SlidersHorizontal size={18} color={colors.white} strokeWidth={2.25} />
          {filtersActive ? (
            <View style={styles.badge} testID="market-filter-badge">
              <Text style={styles.badgeText} testID="market-filter-active-count">
                {activeFilterCount}
              </Text>
            </View>
          ) : null}
        </TouchableOpacity>
        <TouchableOpacity
          style={messages.searchToggle}
          onPress={() => setMenuOpen(true)}
          accessibilityLabel={t('contactProfileScreen.moreActions')}
          accessibilityRole="button"
          accessibilityState={{ expanded: menuOpen }}
          testID="market-header-menu"
        >
          <MoreVertical size={18} color={colors.white} />
        </TouchableOpacity>
      </View>
      <Modal visible={menuOpen} transparent animationType="fade" onRequestClose={closeMenu}>
        <Pressable
          style={menu.backdrop}
          accessible={false}
          onPress={closeMenu}
          testID="market-menu-dismiss"
        >
          <Pressable
            style={menu.sheet}
            accessible={false}
            onPress={(event) => event.stopPropagation()}
          >
            <View style={menu.header}>
              <Text style={menu.title}>{t('market.screen.title')}</Text>
              <TouchableOpacity
                style={menu.button}
                onPress={closeMenu}
                accessibilityLabel={t('chatMenu.close')}
                testID="market-menu-close"
              >
                <X size={22} color={colors.textBody} />
              </TouchableOpacity>
            </View>
            {[
              {
                route: 'MarketMyShop' as const,
                label: t('market.sell.myShop'),
                icon: Store,
                id: 'market-my-shop-button',
              },
              {
                route: 'MarketMyOrders' as const,
                label: t('market.screen.myOrders'),
                accessibilityLabel:
                  payNow > 0
                    ? t('myOrders.openWithPayNow', { invoices: payNow })
                    : t('myOrders.open'),
                icon: ShoppingBag,
                id: 'market-my-orders-button',
              },
              {
                route: 'MarketLikedItems' as const,
                label: t('market.liked.title'),
                icon: Heart,
                id: 'market-liked-items-button',
              },
            ].map(({ route, label, accessibilityLabel, icon: Icon, id }) => (
              <TouchableOpacity
                key={id}
                style={menu.row}
                testID={id}
                accessibilityLabel={accessibilityLabel ?? label}
                accessibilityRole="button"
                onPress={() => {
                  closeMenu();
                  navigation.navigate(route);
                }}
              >
                <Icon size={22} color={colors.textBody} />
                <Text style={menu.text}>{label}</Text>
                {route === 'MarketMyOrders' && payNow > 0 ? (
                  <View style={styles.badge} testID="market-my-orders-badge">
                    <Text style={styles.badgeText}>{payNow > 9 ? '9+' : payNow}</Text>
                  </View>
                ) : null}
              </TouchableOpacity>
            ))}
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}
