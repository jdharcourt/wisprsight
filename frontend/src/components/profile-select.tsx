import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./select/components/select";

export function ProfileSelect({ profiles, value, disabled, onChange }: { profiles: { id: string; name: string }[]; value: string; disabled: boolean; onChange: (value: string) => void }) {
  return (
    <Select items={profiles.map(profile => ({ value: profile.id, label: profile.name }))} value={value || null} onValueChange={value => value && onChange(value)} disabled={disabled || !profiles.length}>
      <SelectTrigger size="sm" variant="ghost" aria-label="Your profile" className="max-w-44"><SelectValue placeholder="Select profile" /></SelectTrigger>
      <SelectContent align="end">{profiles.map(profile => <SelectItem key={profile.id} value={profile.id}>{profile.name}</SelectItem>)}</SelectContent>
    </Select>
  );
}
