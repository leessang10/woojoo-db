//! AWS work area: everything runs through the user's local AWS CLI. Reads are free; changes go through `actions` review.
pub mod cli;
pub mod discovery;
pub mod resources;
pub mod actions;
pub mod topology;
