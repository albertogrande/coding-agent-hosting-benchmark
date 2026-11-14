Rails.application.routes.draw do
  root "tasks#index"

  get "signup", to: "users#new"
  post "signup", to: "users#create"
  get "login", to: "sessions#new"
  post "login", to: "sessions#create"
  delete "logout", to: "sessions#destroy"

  resources :tasks, only: %i[index show create] do
    patch :complete, on: :member
    resources :comments, only: :create
  end

  get "up", to: "rails/health#show", as: :rails_health_check
end
