// spec: ui-spec-v10.md §8.28 v0.10
import { cva } from '../../lib/variants';

/**
 * Five single-class surfaces, no variant axes — by §8.28.7 there is one tab
 * strip and it does not come in flavours. They are `cva`s all the same, as
 * `progressRootVariants` and `valueChipVariants` are, so a consumer imports one
 * shape whatever the class eventually grows into.
 */
export const tabsVariants = cva('salt-tabs');
export const tabsListVariants = cva('salt-tabs__list');
export const tabsTriggerVariants = cva('salt-tabs__trigger');
export const tabsCountVariants = cva('salt-tabs__count');
export const tabsContentVariants = cva('salt-tabs__panel');
