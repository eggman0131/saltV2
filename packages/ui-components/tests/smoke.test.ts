// spec: SPEC.md §6 v0.3
import { describe, it, expect } from 'vitest';
import * as pkg from '../src/index.js';

describe('@salt/ui-components', () => {
  it('is importable', () => {
    expect(pkg).toBeDefined();
  });

  describe('v0.2 exports', () => {
    it('exports Button', () => expect(pkg.Button).toBeDefined());
    it('exports Card and parts', () => {
      expect(pkg.Card).toBeDefined();
      expect(pkg.CardContent).toBeDefined();
      expect(pkg.CardDescription).toBeDefined();
      expect(pkg.CardFooter).toBeDefined();
      expect(pkg.CardHeader).toBeDefined();
      expect(pkg.CardTitle).toBeDefined();
    });
    it('exports Checkbox', () => expect(pkg.Checkbox).toBeDefined());
    it('exports Dialog and parts', () => {
      expect(pkg.Dialog).toBeDefined();
      expect(pkg.DialogClose).toBeDefined();
      expect(pkg.DialogContent).toBeDefined();
      expect(pkg.DialogDescription).toBeDefined();
      expect(pkg.DialogFooter).toBeDefined();
      expect(pkg.DialogHeader).toBeDefined();
      expect(pkg.DialogTitle).toBeDefined();
      expect(pkg.DialogTrigger).toBeDefined();
    });
    it('exports layout primitives', () => {
      expect(pkg.Divider).toBeDefined();
      expect(pkg.Grid).toBeDefined();
      expect(pkg.Heading).toBeDefined();
      expect(pkg.Icon).toBeDefined();
      expect(pkg.Inline).toBeDefined();
      expect(pkg.Stack).toBeDefined();
      expect(pkg.Text).toBeDefined();
    });
    it('exports Popover and parts', () => {
      expect(pkg.Popover).toBeDefined();
      expect(pkg.PopoverContent).toBeDefined();
      expect(pkg.PopoverTrigger).toBeDefined();
    });
    it('exports Progress', () => expect(pkg.Progress).toBeDefined());
    it('exports Spinner', () => expect(pkg.Spinner).toBeDefined());
    it('exports Switch', () => expect(pkg.Switch).toBeDefined());
    it('exports TextArea', () => expect(pkg.TextArea).toBeDefined());
    it('exports TextField', () => expect(pkg.TextField).toBeDefined());
    it('exports Tooltip and parts', () => {
      expect(pkg.Tooltip).toBeDefined();
      expect(pkg.TooltipContent).toBeDefined();
      expect(pkg.TooltipProvider).toBeDefined();
      expect(pkg.TooltipTrigger).toBeDefined();
    });
  });

  describe('v0.3 exports', () => {
    it('exports RadioGroup and RadioGroupItem', () => {
      expect(pkg.RadioGroup).toBeDefined();
      expect(pkg.RadioGroupItem).toBeDefined();
    });
    it('exports Select and all parts', () => {
      expect(pkg.Select).toBeDefined();
      expect(pkg.SelectContent).toBeDefined();
      expect(pkg.SelectGroup).toBeDefined();
      expect(pkg.SelectItem).toBeDefined();
      expect(pkg.SelectLabel).toBeDefined();
      expect(pkg.SelectSeparator).toBeDefined();
      expect(pkg.SelectTrigger).toBeDefined();
    });
    it('exports Slider and all parts', () => {
      expect(pkg.Slider).toBeDefined();
      expect(pkg.SliderRange).toBeDefined();
      expect(pkg.SliderThumb).toBeDefined();
      expect(pkg.SliderTrack).toBeDefined();
    });
    it('exports Sheet and all parts', () => {
      expect(pkg.Sheet).toBeDefined();
      expect(pkg.SheetClose).toBeDefined();
      expect(pkg.SheetContent).toBeDefined();
      expect(pkg.SheetDescription).toBeDefined();
      expect(pkg.SheetFooter).toBeDefined();
      expect(pkg.SheetHeader).toBeDefined();
      expect(pkg.SheetTitle).toBeDefined();
      expect(pkg.SheetTrigger).toBeDefined();
    });
    it('exports Toast and all parts', () => {
      expect(pkg.Toast).toBeDefined();
      expect(pkg.ToastAction).toBeDefined();
      expect(pkg.ToastClose).toBeDefined();
      expect(pkg.ToastDescription).toBeDefined();
      expect(pkg.ToastProvider).toBeDefined();
      expect(pkg.ToastTitle).toBeDefined();
      expect(pkg.ToastViewport).toBeDefined();
    });
  });

  describe('helpers and tokens', () => {
    it('exports cn helper', () => expect(pkg.cn).toBeDefined());
    it('exports useId helper', () => expect(pkg.useId).toBeDefined());
    it('exports tokens namespace', () => expect(pkg.tokens).toBeDefined());
  });
});
