import type { ThemeConfig } from 'antd'

export const themeConfig: ThemeConfig = {
  token: {
    colorPrimary: '#4F46E5',
    colorInfo: '#4F46E5',
    colorSuccess: '#16A34A',
    colorWarning: '#F59E0B',
    colorError: '#EF4444',
    colorBgLayout: '#F6F7FB',
    colorBgContainer: '#FFFFFF',
    colorBgElevated: '#FFFFFF',
    colorText: '#111827',
    colorTextSecondary: '#6B7280',
    colorTextTertiary: '#9CA3AF',
    colorBorder: '#E5E7EB',
    colorBorderSecondary: '#F3F4F6',
    borderRadius: 10,
    borderRadiusLG: 12,
    borderRadiusSM: 8,
    fontSize: 14,
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif',
  },
  components: {
    Layout: {
      bodyBg: '#F6F7FB',
      headerBg: '#FFFFFF',
      siderBg: '#FFFFFF',
      headerHeight: 56,
    },
    Menu: {
      itemBg: 'transparent',
      subMenuItemBg: 'transparent',
      itemBorderRadius: 8,
      itemHoverBg: '#F3F4F6',
      itemSelectedBg: '#EEF2FF',
      itemSelectedColor: '#4F46E5',
      itemHoverColor: '#111827',
    },
    Button: {
      borderRadius: 8,
      controlHeight: 36,
    },
    Input: {
      borderRadius: 8,
      controlHeight: 36,
    },
    Card: {
      borderRadiusLG: 12,
    },
    Tabs: {
      itemActiveColor: '#111827',
      itemHoverColor: '#4F46E5',
      itemSelectedColor: '#4F46E5',
      inkBarColor: '#4F46E5',
    },
    List: {
      itemPadding: '16px 0',
    },
    Statistic: {
      titleFontSize: 13,
    },
  },
}
