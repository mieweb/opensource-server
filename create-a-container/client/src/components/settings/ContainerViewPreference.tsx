import { Radio, RadioGroup } from '@mieweb/ui';
import {
  setContainerViewDefault,
  useContainerViewDefault,
} from '@/lib/containerViewPreference';

/**
 * Personal (per-browser) preferences, available to every user on the Settings
 * page. Currently just the default container view. Persisted to localStorage,
 * so no server round-trip and no admin rights required.
 */
export function ContainerViewPreference() {
  const value = useContainerViewDefault();

  return (
    <section className="grid gap-4">
      <div>
        <h2 className="text-lg font-semibold">Preferences</h2>
        <p className="text-sm text-(--color-muted,#6b7280)">Saved in this browser.</p>
      </div>
      <RadioGroup
        name="container-view-default"
        label="Default container view"
        description="What the Containers list shows when you first open it."
        value={value}
        onValueChange={(v) => setContainerViewDefault(v === 'all' ? 'all' : 'own')}
      >
        <Radio value="own" label="Only my containers" />
        <Radio
          value="all"
          label="All containers I can access"
          description="Includes containers shared with me (and, for admins, every user's)."
        />
      </RadioGroup>
    </section>
  );
}
