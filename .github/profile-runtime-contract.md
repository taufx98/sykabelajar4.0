# Profile runtime contract

The Profile page must only query columns that are confirmed to exist in the production `public.profiles` schema or access derived values through existing RPC/services.

Known production `profiles` fields verified during the post-merge audit include:
- id
- username
- full_name
- grade
- institution
- avatar_url
- bio
- is_public
- created_at
- updated_at
- avatar_public_id
- avatar_width
- avatar_height
- avatar_version
- avatar_resource_type
- birth_date
- school_id
- guardian_name
- account_type
- whatsapp
- subjects
- cover_url
- cover_public_id
- cover_width
- cover_height
- cover_version
- cover_resource_type
- total_xp
- edu_coin
- badge_showcase
- badge_showcase_manual
- pembina
- last_name_change
- accept_messages
- verification_type

Do not add derived/nonexistent fields such as `competitions_joined`, `role`, `city`, or `country` to direct profile selects unless the database schema is first changed and deployed with all required compatibility controls.
