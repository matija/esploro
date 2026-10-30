const KEYCHAIN_SERVICE: &str = "app.esploro.mcp";
const KEYCHAIN_ACCOUNT: &str = "bearer-token";

pub fn load_or_create() -> Result<String, keyring::Error> {
    load_or_create_with(&keyring::Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT)?)
}

pub fn replace() -> Result<String, keyring::Error> {
    replace_with(&keyring::Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT)?)
}

fn replace_with(store: &impl Store) -> Result<String, keyring::Error> {
    let token = format!(
        "{}{}",
        uuid::Uuid::new_v4().simple(),
        uuid::Uuid::new_v4().simple()
    );
    store.set(&token)?;
    Ok(token)
}

trait Store {
    fn get(&self) -> Result<String, keyring::Error>;
    fn set(&self, token: &str) -> Result<(), keyring::Error>;
}

impl Store for keyring::Entry {
    fn get(&self) -> Result<String, keyring::Error> {
        self.get_password()
    }

    fn set(&self, token: &str) -> Result<(), keyring::Error> {
        self.set_password(token)
    }
}

fn load_or_create_with(store: &impl Store) -> Result<String, keyring::Error> {
    match store.get() {
        Ok(token) => Ok(token),
        Err(keyring::Error::NoEntry) => replace_with(store),
        Err(error) => Err(error),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;

    #[derive(Default)]
    struct MemoryStore {
        token: RefCell<Option<String>>,
        fail_read: bool,
        fail_write: bool,
    }

    impl Store for MemoryStore {
        fn get(&self) -> Result<String, keyring::Error> {
            if self.fail_read {
                return Err(keyring::Error::NoStorageAccess(Box::new(
                    std::io::Error::other("read failed"),
                )));
            }
            self.token.borrow().clone().ok_or(keyring::Error::NoEntry)
        }

        fn set(&self, token: &str) -> Result<(), keyring::Error> {
            if self.fail_write {
                return Err(keyring::Error::NoStorageAccess(Box::new(
                    std::io::Error::other("write failed"),
                )));
            }
            *self.token.borrow_mut() = Some(token.into());
            Ok(())
        }
    }

    #[test]
    fn first_use_generates_and_persists_random_token() {
        let store = MemoryStore::default();
        let token = load_or_create_with(&store).unwrap();
        assert!(token.len() == 64 && token.bytes().all(|b| b.is_ascii_hexdigit()));
        assert!(store.token.borrow().as_ref() == Some(&token));
        assert!(load_or_create_with(&MemoryStore::default()).unwrap() != token);
    }

    #[test]
    fn restart_reuses_persisted_token_without_writing() {
        let store = MemoryStore::default();
        let token = load_or_create_with(&store).unwrap();
        let restarted = MemoryStore {
            token: RefCell::new(store.token.into_inner()),
            fail_write: true,
            ..MemoryStore::default()
        };
        assert!(load_or_create_with(&restarted).unwrap() == token);
    }

    #[test]
    fn read_error_does_not_generate_or_persist_token() {
        let store = MemoryStore {
            fail_read: true,
            ..MemoryStore::default()
        };
        assert!(matches!(
            load_or_create_with(&store),
            Err(keyring::Error::NoStorageAccess(_))
        ));
        assert!(store.token.borrow().is_none());
    }

    #[test]
    fn replacement_persists_fresh_token_and_failure_preserves_old_token() {
        let mut store = MemoryStore::default();
        let old = load_or_create_with(&store).unwrap();
        let new = replace_with(&store).unwrap();
        assert_ne!(old, new);
        assert!(new.len() == 64 && new.bytes().all(|b| b.is_ascii_hexdigit()));
        assert_eq!(load_or_create_with(&store).unwrap(), new);
        store.fail_write = true;
        assert!(replace_with(&store).is_err());
        assert_eq!(load_or_create_with(&store).unwrap(), new);
    }

    #[test]
    fn write_error_does_not_return_token() {
        let store = MemoryStore {
            fail_write: true,
            ..MemoryStore::default()
        };
        assert!(matches!(
            load_or_create_with(&store),
            Err(keyring::Error::NoStorageAccess(_))
        ));
        assert!(store.token.borrow().is_none());
    }
}
