import {
  ChangeDetectorRef,
  Directive,
  ElementRef,
  EmbeddedViewRef,
  Inject,
  Input,
  OnChanges,
  OnDestroy,
  OnInit,
  Optional,
  TemplateRef,
  Type,
  ViewContainerRef
} from '@angular/core';
import { Subscription } from 'rxjs';
import { switchMap, take } from 'rxjs/operators';
import { TemplateHandler, View } from './template-handler';
import { TRANSLOCO_LANG } from './transloco-lang';
import { TRANSLOCO_LOADING_TEMPLATE } from './transloco-loading-template';
import { TRANSLOCO_SCOPE } from './transloco-scope';
import { TranslocoService } from './transloco.service';
import { HashMap, Translation } from './types';
import { getValue, getPipeValue } from './helpers';
import { shouldListenToLangChanges } from './shared';

@Directive({
  selector: '[transloco]'
})
export class TranslocoDirective implements OnInit, OnDestroy, OnChanges {
  subscription: Subscription = Subscription.EMPTY;
  view: EmbeddedViewRef<any>;

  @Input('transloco') key: string;
  @Input('translocoParams') params: HashMap = {};
  @Input('translocoScope') inlineScope: string | undefined;
  @Input('translocoRead') inlineRead: string | undefined;
  @Input('translocoLang') inlineLang: string | undefined;
  @Input('translocoLoadingTpl') inlineTpl: TemplateRef<any> | undefined;

  private langName: string;
  private loaderTplHandler: TemplateHandler = null;
  // Whether we already rendered the view once
  private initialized = false;

  constructor(
    private translocoService: TranslocoService,
    @Optional() private tpl: TemplateRef<any>,
    @Optional() @Inject(TRANSLOCO_SCOPE) private providerScope: string | null,
    @Optional() @Inject(TRANSLOCO_LANG) private providerLang: string | null,
    @Optional() @Inject(TRANSLOCO_LOADING_TEMPLATE) private providedLoadingTpl: Type<any> | string,
    private vcr: ViewContainerRef,
    private cdr: ChangeDetectorRef,
    private host: ElementRef
  ) {}

  ngOnInit() {
    const loadingTpl = this.getLoadingTpl();
    if (loadingTpl) {
      this.loaderTplHandler = new TemplateHandler(loadingTpl, this.vcr);
      this.loaderTplHandler.attachView();
    }

    const listenToLangChange = shouldListenToLangChanges(this.translocoService, this.providerLang || this.inlineLang);

    this.subscription = this.translocoService.langChanges$
      .pipe(
        switchMap(() => {
          const lang = this.getLang();
          const scope = this.getScope();
          this.langName = scope ? `${scope}/${lang}` : lang;
          return this.translocoService._loadDependencies(this.langName);
        }),
        listenToLangChange ? source => source : take(1)
      )
      .subscribe(() => {
        /* In case the scope strategy is set to 'shared' we want to load the scope's language instead of the scope
        itself in order to expose the global translations as well.
        the scopes translations are merged to the global when using this strategy */
        let targetLang = this.langName;
        const scope = this.getScope();
        if (scope) {
          targetLang = this.translocoService.isSharedScope ? this.getLang() : this.langName;
        }
        const translation = this.translocoService.getTranslation(targetLang);
        this.langName = targetLang;
        this.tpl === null ? this.simpleStrategy() : this.structuralStrategy(translation);
        this.cdr.markForCheck();
        this.initialized = true;
      });
  }

  ngOnChanges(changes) {
    // We need to support dynamic keys/params, so if this is not the first change CD cycle
    // we need to run the function again in order to update the value
    const notInit = Object.keys(changes).some(v => changes[v].firstChange === false);
    notInit && this.simpleStrategy();
  }

  private simpleStrategy() {
    this.detachLoader();
    this.host.nativeElement.innerText = this.translocoService.translate(this.key, this.params, this.langName);
  }

  private structuralStrategy(data: Translation) {
    const translations = this.inlineRead ? getValue(data, this.inlineRead) : data;
    if (this.view) {
      this.view.context['$implicit'] = translations;
    } else {
      this.detachLoader();
      this.view = this.vcr.createEmbeddedView(this.tpl, {
        $implicit: translations
      });
    }
  }

  private getLoadingTpl(): View {
    return this.inlineTpl || this.providedLoadingTpl;
  }

  // inline => providers
  private getScope() {
    return this.inlineScope || this.providerScope;
  }

  // inline => providers => global
  private getLang() {
    /**
     * When the user changes the lang we need to update
     * the view. Otherwise, the lang will remain the inline/provided lang
     */
    if (this.initialized) {
      return this.translocoService.getActiveLang();
    }

    if (this.inlineLang) {
      const [_, lang] = getPipeValue(this.inlineLang, 'static');
      return lang;
    }

    if (this.providerLang) {
      const [_, lang] = getPipeValue(this.providerLang, 'static');
      return lang;
    }

    return this.translocoService.getActiveLang();
  }

  ngOnDestroy() {
    this.subscription.unsubscribe();
  }

  private detachLoader() {
    this.loaderTplHandler && this.loaderTplHandler.detachView();
  }
}
