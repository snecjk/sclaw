import { useSkillPlazaStore } from '@/stores/skill-plaza';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

export function SkillPlazaCategoryNav() {
  const { t } = useTranslation('skills');
  const { categories, categoryCounts, activeCategory, setActiveCategory } = useSkillPlazaStore();

  // Fixed category order from spec
  const fixedOrder = [
    { slug: '', label: t('plaza.category.all', { defaultValue: '全部' }) },
    { slug: 'jishu', label: t('plaza.category.jishu', { defaultValue: '技术' }) },
    { slug: 'chanpin', label: t('plaza.category.chanpin', { defaultValue: '产品' }) },
    { slug: 'sheji', label: t('plaza.category.sheji', { defaultValue: '设计' }) },
    { slug: 'xingzheng', label: t('plaza.category.xingzheng', { defaultValue: '行政' }) },
    { slug: 'caiwu', label: t('plaza.category.caiwu', { defaultValue: '财务' }) },
    { slug: 'hr', label: t('plaza.category.hr', { defaultValue: 'HR' }) },
    { slug: 'tongyong', label: t('plaza.category.tongyong', { defaultValue: '通用' }) },
    { slug: 'moban', label: t('plaza.category.moban', { defaultValue: '模板' }) },
    { slug: 'wangluo', label: t('plaza.category.wangluo', { defaultValue: '网络' }) },
    { slug: 'zhengce', label: t('plaza.category.zhengce', { defaultValue: '政策' }) },
    { slug: 'yunying', label: t('plaza.category.yunying', { defaultValue: '运营' }) },
    { slug: 'kefu', label: t('plaza.category.kefu', { defaultValue: '客服' }) },
    { slug: 'qita', label: t('plaza.category.qita', { defaultValue: '其他' }) },
  ];

  // Merge backend categories with fixed order (backend may return subset)
  const displayCategories = fixedOrder.map((fixed) => {
    const backendCat = categories.find((c) => c.slug === fixed.slug);
    return {
      slug: fixed.slug,
      label: backendCat?.label || fixed.label,
      count: categoryCounts[fixed.slug] ?? 0,
    };
  });

  return (
    <div className="flex items-center gap-1 mb-5 overflow-x-auto pb-1 scrollbar-hide">
      {displayCategories.map((cat) => (
        <button
          key={cat.slug}
          onClick={() => setActiveCategory(cat.slug)}
          aria-selected={activeCategory === cat.slug}
          className={cn(
            'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm whitespace-nowrap transition-all',
            activeCategory === cat.slug
              ? 'bg-[#FF6F00]/10 text-[#FF6F00] font-medium'
              : 'text-muted-foreground hover:text-foreground hover:bg-muted',
          )}
        >
          <span>{cat.label}</span>
          <span
            className={cn(
              'text-xs px-1.5 py-0.5 rounded-full',
              activeCategory === cat.slug
                ? 'bg-[#FF6F00]/15 text-[#FF6F00]'
                : 'bg-muted text-muted-foreground',
            )}
          >
            {cat.count}
          </span>
        </button>
      ))}
    </div>
  );
}
