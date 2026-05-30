import { useSkillPlazaStore } from '@/stores/skill-plaza';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

export function SkillPlazaCategoryNav() {
  const { t } = useTranslation('skills');
  const { categories, categoryCounts, activeCategory, setActiveCategory } = useSkillPlazaStore();

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

  const displayCategories = fixedOrder.map((fixed) => {
    const backendCat = categories.find((c) => c.slug === fixed.slug);
    return {
      slug: fixed.slug,
      label: backendCat?.label || fixed.label,
      count: categoryCounts[fixed.slug] ?? 0,
    };
  });

  return (
    <nav className="flex flex-wrap items-center gap-x-5 gap-y-2 my-2.5 mx-0 p-0" aria-label="技能分类">
      {displayCategories.map((cat) => (
        <button
          key={cat.slug}
          onClick={() => setActiveCategory(cat.slug)}
          className={cn(
            'inline-flex items-center gap-0.5 px-3 py-1.5 border-none rounded-lg bg-transparent text-sm font-medium whitespace-nowrap cursor-pointer transition-colors',
            activeCategory === cat.slug
              ? 'bg-[#e5e7eb] text-[#111827] font-semibold'
              : 'text-[#9ca3af] hover:text-[#6b7280]',
          )}
        >
          <span>{cat.label}</span>
          <span
            className={cn(
              'text-sm font-medium tabular-nums',
              activeCategory === cat.slug ? 'text-[#6b7280]' : 'text-[#b0b7c3]',
            )}
          >
            {cat.count}
          </span>
        </button>
      ))}
    </nav>
  );
}
