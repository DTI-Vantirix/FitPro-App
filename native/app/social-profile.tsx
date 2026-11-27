import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Action, Card, ErrorNotice, Field, Heading, Icon, Notice, SectionHeading } from '../src/components/Ui';
import { Brand, Gated, Loading, Note, Screen } from '../src/run/ui/Screen';
import { saveProfile } from '../src/social/api';
import { cleanHandle, profileEdit } from '../src/social/logic';
import { useSocial, words } from '../src/social/use-social';
import { colors } from '../src/theme';
import { type } from '../src/typography';

const ACCOUNT_CHOICES = [
  { id: 'public', label: 'Public', detail: 'Anyone can follow you and see your public posts', icon: 'globe' },
  { id: 'private', label: 'Private', detail: 'Every request needs your approval, posts stay with friends', icon: 'lock' },
] as const;

/** The website's Social profile card (Settings): handle, display name, one line about you,
 * and whether the account is public or private. */
function SocialProfileEditor() {
  const router = useRouter();
  const { me, loadMe, setProfile } = useSocial();
  const [handle, setHandle] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [bio, setBio] = useState('');
  const [visibility, setVisibility] = useState<'public' | 'private'>('private');
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const { profile } = await loadMe();
      setHandle(profile.handle);
      setDisplayName(profile.displayName);
      setBio(profile.bio);
      setVisibility(profile.visibility);
      setLoaded(true);
    } catch (cause) {
      setError(words(cause));
    }
  }, [loadMe]);

  useEffect(() => { void load(); }, [load]);

  async function save() {
    if (!me) return;
    const edit = profileEdit({ handle, displayName, bio, visibility });
    setSaved(false);
    if (!edit.ok) { setError(edit.error); return; }
    setSaving(true);
    setError(null);
    try {
      const next = await saveProfile(me.token, me.profile, edit.values);
      setProfile(next);
      setHandle(next.handle);
      setDisplayName(next.displayName);
      setSaved(true);
    } catch (cause) {
      setError(words(cause));
    } finally {
      setSaving(false);
    }
  }

  const back = () => (router.canGoBack() ? router.back() : router.replace('/settings'));

  if (!loaded && !error) return <Loading label="Loading your profile…" />;

  return <Screen>
    <Brand onBack={back} />
    <SectionHeading kicker="Settings" title="Social profile"
      subtitle="How friends find you and who sees what you post. Nothing is ever posted automatically — every run you share is one you pick." />
    <ErrorNotice message={error} />
    {!loaded
      ? <Action label="Try again" secondary onPress={() => { void load(); }} />
      : <>
        <Field label="Handle (@)" value={handle} onChangeText={(value) => { setHandle(cleanHandle(value)); setSaved(false); }} placeholder="your.handle" maxLength={24} />
        <Field label="Display name" value={displayName} onChangeText={(value) => { setDisplayName(value); setSaved(false); }} autoCapitalize="sentences" maxLength={60} />
        <Field label="One line about you" value={bio} onChangeText={(value) => { setBio(value); setSaved(false); }} placeholder="Chasing a sub-20 5k" autoCapitalize="sentences" maxLength={140} />

        <Heading size={16}>Account</Heading>
        <View style={local.choices}>
          {ACCOUNT_CHOICES.map((choice) => {
            const on = visibility === choice.id;
            return <Pressable key={choice.id} accessibilityRole="button" accessibilityLabel={`${choice.label} account`} accessibilityState={{ selected: on }}
              onPress={() => { setVisibility(choice.id); setSaved(false); }} style={({ pressed }) => pressed && local.pressed}>
              <Card selected={on} style={local.choice}>
                <View style={local.choiceTitle}>
                  <Icon name={choice.icon} size={15} color={on ? colors.accent : colors.text} />
                  <Text style={[type.bodyStrong, on && { color: colors.accent }]}>{choice.label}</Text>
                </View>
                <Text style={type.small}>{choice.detail}</Text>
              </Card>
            </Pressable>;
          })}
        </View>
        {visibility === 'public' && <Notice>With a public account, friend requests are accepted straight away and a new post starts as Public. You can still choose Friends or Only me on each post.</Notice>}

        <Action label={saving ? 'Saving…' : saved ? 'Saved' : 'Save social profile'} icon={saved ? 'check' : undefined} busy={saving} onPress={() => { void save(); }} />
        <Note>Your handle and display name can be found by anyone signed in to VantraRun. Posts you already made keep the name they were posted with.</Note>
      </>}
  </Screen>;
}

const local = StyleSheet.create({
  choices: { gap: 10, marginTop: 10, marginBottom: 4 },
  choice: { marginBottom: 0, gap: 6, borderRadius: 16, padding: 14 },
  choiceTitle: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  pressed: { opacity: 0.7 },
});

export default function SocialProfileScreen() {
  return <Gated><SocialProfileEditor /></Gated>;
}
