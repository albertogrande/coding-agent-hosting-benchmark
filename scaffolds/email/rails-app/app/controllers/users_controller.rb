class UsersController < ApplicationController
  def new
    @user = User.new
  end

  def create
    @user = User.new(params.expect(user: %i[name email password]))
    if @user.save
      session[:user_id] = @user.id
      redirect_to tasks_path
    else
      render :new, status: :unprocessable_entity
    end
  end
end
